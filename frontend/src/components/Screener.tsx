import { useState, useEffect, useRef, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { RateLimitError } from "@/components/RateLimitError"
import { apiFetch } from "@/lib/api"

type Stock = {
  ticker: string
  name: string
  sector: string
  industry: string
  price: number
  change: number
  marketCap: string
  marketCapRaw: number
  peRatio: number | null
  pbRatio: number | null
  beta: number | null
  dividendYield: number | null
  weekChange52: number | null
}

type Props = {
  apiUrl: string
  apiToken: string
  watchlist: string[]
  onNavigate: (ticker: string) => void
  onToggleWatchlist: (ticker: string) => void
}

type SortKey = keyof Stock
type SortDir = "asc" | "desc"

const SECTORS = [
  "All Sectors",
  "Technology",
  "Healthcare",
  "Financial Services",
  "Consumer Cyclical",
  "Consumer Defensive",
  "Industrials",
  "Energy",
  "Utilities",
  "Real Estate",
  "Basic Materials",
  "Communication Services",
]

const MARKET_CAP_OPTIONS = [
  { label: "Any", min: 0, max: Infinity },
  { label: "Mega (>$200B)", min: 200e9, max: Infinity },
  { label: "Large ($10B–$200B)", min: 10e9, max: 200e9 },
  { label: "Mid ($2B–$10B)", min: 2e9, max: 10e9 },
  { label: "Small (<$2B)", min: 0, max: 2e9 },
]

function fmtRatio(v: number | null | undefined): string {
  if (v == null) return "—"
  return v.toFixed(1)
}

function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`
  const csv = [headers, ...rows].map(r => r.map(escape).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function FilterInput({
  label, placeholder, value, onChange
}: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <input
        type="number"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-1.5 rounded-md bg-secondary border border-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary text-sm"
      />
    </div>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="text-muted-foreground ml-1 opacity-30">↕</span>
  return <span className="text-primary ml-1">{dir === "asc" ? "↑" : "↓"}</span>
}

export function Screener({ apiUrl, apiToken, watchlist, onNavigate, onToggleWatchlist }: Props) {
  const [allStocks, setAllStocks] = useState<Stock[]>([])
  const [loading, setLoading] = useState(false)
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState<{ kind: "message"; text: string } | { kind: "rate_limit"; retryAfter: number } | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>("marketCapRaw")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  // Filters
  const [sector, setSector] = useState("All Sectors")
  const [marketCap, setMarketCap] = useState(0)
  const [maxPE, setMaxPE] = useState("")
  const [maxPB, setMaxPB] = useState("")
  const [minDivYield, setMinDivYield] = useState("")
  const [minBeta, setMinBeta] = useState("")
  const [maxBeta, setMaxBeta] = useState("")
  const [minWeekChange, setMinWeekChange] = useState("")

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiToken}`
  }

  const fetchData = async () => {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null }
    setLoading(true)
    setError(null)
    setBuilding(false)
    const result = await apiFetch<Stock[]>(`${apiUrl}/screener/data`, { headers })
    setLoading(false)
    if (!result.ok) {
      const err = result.error
      if (err.kind === "building") {
        // Server is building the dataset in the background — poll every 5s
        setBuilding(true)
        pollRef.current = setTimeout(fetchData, 5000)
      } else if (err.kind === "rate_limit") {
        setError({ kind: "rate_limit", retryAfter: err.retryAfter })
      } else {
        setError({ kind: "message", text: err.kind === "network" ? err.detail : (err as { detail: string }).detail || "Failed to load screener data" })
      }
      return
    }
    setBuilding(false)
    setAllStocks(result.data)
  }

  // Start fetch on mount; clean up any pending poll on unmount
  useEffect(() => {
    fetchData()
    return () => { if (pollRef.current) clearTimeout(pollRef.current) }
  }, [])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const filtered = useMemo(() => {
    const capOption = MARKET_CAP_OPTIONS[marketCap]
    return allStocks.filter(s => {
      if (sector !== "All Sectors" && s.sector !== sector) return false
      if (s.marketCapRaw < capOption.min || s.marketCapRaw > capOption.max) return false
      if (maxPE && s.peRatio !== null && s.peRatio > parseFloat(maxPE)) return false
      if (maxPB && s.pbRatio != null && s.pbRatio > parseFloat(maxPB)) return false
      if (minDivYield && (s.dividendYield == null || s.dividendYield < parseFloat(minDivYield))) return false
      if (minBeta && (s.beta == null || s.beta < parseFloat(minBeta))) return false
      if (maxBeta && s.beta != null && s.beta > parseFloat(maxBeta)) return false
      if (minWeekChange && (s.weekChange52 == null || s.weekChange52 < parseFloat(minWeekChange))) return false
      return true
    }).sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
  }, [allStocks, sector, marketCap, maxPE, maxPB, minDivYield, minBeta, maxBeta, sortKey, sortDir])

  const resetFilters = () => {
    setSector("All Sectors")
    setMarketCap(0)
    setMaxPE("")
    setMaxPB("")
    setMinDivYield("")
    setMinBeta("")
    setMaxBeta("")
    setMinWeekChange("")
  }

  const PRESETS: { label: string; apply: () => void }[] = [
    {
      label: "Value",
      apply: () => { resetFilters(); setMaxPE("15"); setMaxPB("2") },
    },
    {
      label: "High Dividend",
      apply: () => { resetFilters(); setMinDivYield("3") },
    },
    {
      label: "Low Volatility",
      apply: () => { resetFilters(); setMaxBeta("0.8") },
    },
    {
      label: "Momentum",
      apply: () => { resetFilters(); setMinWeekChange("20") },
    },
    {
      label: "Mega Cap",
      apply: () => { resetFilters(); setMarketCap(1) },
    },
  ]

  const cols: { label: string; key: SortKey; fmt: (s: Stock) => string; colorFn?: (s: Stock) => string }[] = [
    { label: "Ticker",   key: "ticker",      fmt: s => s.ticker },
    { label: "Name",     key: "name",        fmt: s => s.name },
    { label: "Sector",   key: "sector",      fmt: s => s.sector },
    { label: "Price",    key: "price",       fmt: s => `$${s.price.toFixed(2)}` },
    { label: "Change",   key: "change",      fmt: s => `${s.change.toFixed(2)}%`,  colorFn: s => s.change >= 0 ? "text-green-500" : "text-red-500" },
    { label: "Mkt Cap",  key: "marketCapRaw", fmt: s => s.marketCap },
    { label: "P/E",      key: "peRatio",     fmt: s => fmtRatio(s.peRatio) },
    { label: "P/B",      key: "pbRatio",     fmt: s => fmtRatio(s.pbRatio) },
    { label: "Beta",     key: "beta",        fmt: s => fmtRatio(s.beta) },
    { label: "Div Yield",key: "dividendYield", fmt: s => s.dividendYield != null ? `${s.dividendYield.toFixed(2)}%` : "—" },
  ]

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Screener Filters
            <button
              onClick={resetFilters}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Reset
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Presets */}
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(p => (
              <button
                key={p.label}
                onClick={p.apply}
                className="px-3 py-1 rounded-full text-xs font-medium bg-secondary text-muted-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Sector */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Sector</label>
              <select
                value={sector}
                onChange={e => setSector(e.target.value)}
                className="w-full px-3 py-1.5 rounded-md bg-secondary border border-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Market Cap */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Market Cap</label>
              <select
                value={marketCap}
                onChange={e => setMarketCap(parseInt(e.target.value))}
                className="w-full px-3 py-1.5 rounded-md bg-secondary border border-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {MARKET_CAP_OPTIONS.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
              </select>
            </div>

            <FilterInput label="Max P/E"           placeholder="e.g. 30"  value={maxPE}       onChange={setMaxPE} />
            <FilterInput label="Max P/B"           placeholder="e.g. 5"   value={maxPB}       onChange={setMaxPB} />
            <FilterInput label="Min Dividend Yield (%)" placeholder="e.g. 2" value={minDivYield} onChange={setMinDivYield} />
            <FilterInput label="Min Beta"           placeholder="e.g. 0.5"  value={minBeta}       onChange={setMinBeta} />
            <FilterInput label="Max Beta"           placeholder="e.g. 1.5"  value={maxBeta}       onChange={setMaxBeta} />
            <FilterInput label="Min 52W Change (%)" placeholder="e.g. 20"   value={minWeekChange} onChange={setMinWeekChange} />
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>
              Results
              {!loading && allStocks.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  {filtered.length} of {allStocks.length} stocks
                </span>
              )}
            </span>
            {allStocks.length > 0 && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const headers = ["Ticker", "Name", "Sector", "Price", "Change %", "Market Cap", "P/E", "P/B", "Beta", "Div Yield %"]
                    const csvRows = filtered.map(s => [
                      s.ticker,
                      s.name,
                      s.sector,
                      s.price.toFixed(2),
                      s.change.toFixed(2),
                      s.marketCap,
                      s.peRatio != null ? s.peRatio.toFixed(1) : "",
                      s.pbRatio != null ? s.pbRatio.toFixed(1) : "",
                      s.beta != null ? s.beta.toFixed(2) : "",
                      s.dividendYield != null ? s.dividendYield.toFixed(2) : "",
                    ])
                    downloadCSV("screener.csv", headers, csvRows)
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Export CSV
                </button>
                <button
                  onClick={fetchData}
                  disabled={loading}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  Refresh data
                </button>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {building && (
            <div className="text-center py-8 space-y-3">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <p className="text-sm text-muted-foreground">Building screener dataset…</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Fetching live data for 500+ stocks. This takes about 60 seconds on first load, then caches for 24 hours.
              </p>
            </div>
          )}

          {loading && !building && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground">Loading screener data...</p>
              </div>
              <div className="space-y-3 animate-pulse">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="h-4 bg-secondary rounded w-12" />
                    <div className="h-4 bg-secondary rounded w-40" />
                    <div className="h-4 bg-secondary rounded w-24" />
                    <div className="h-4 bg-secondary rounded w-16 ml-auto" />
                    <div className="h-4 bg-secondary rounded w-16" />
                    <div className="h-4 bg-secondary rounded w-16" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && error.kind === "rate_limit" && (
            <RateLimitError
              retryAfter={error.retryAfter}
              onRetry={fetchData}
              message="Screener data rate limited."
            />
          )}
          {error && error.kind === "message" && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
              <span className="text-destructive text-sm mt-0.5">⚠</span>
              <div className="flex-1">
                <p className="text-sm text-destructive font-medium">{error.text}</p>
                <button
                  onClick={fetchData}
                  className="text-xs text-muted-foreground hover:text-foreground mt-1 underline transition-colors"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {!loading && allStocks.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {cols.map(col => (
                      <th
                        key={col.key}
                        className="py-2 text-right first:text-left text-muted-foreground font-medium cursor-pointer hover:text-foreground transition-colors select-none px-2 whitespace-nowrap"
                        onClick={() => handleSort(col.key)}
                      >
                        {col.label}
                        <SortIcon active={sortKey === col.key} dir={sortDir} />
                      </th>
                    ))}
                    <th className="py-2 px-2 w-6" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={cols.length} className="py-8 text-center text-muted-foreground text-sm">
                        No stocks match your filters.
                      </td>
                    </tr>
                  )}
                  {filtered.slice(0, 200).map(s => (
                    <tr
                      key={s.ticker}
                      className="border-b border-border hover:bg-secondary transition-colors cursor-pointer"
                      onClick={() => onNavigate(s.ticker)}
                    >
                      {cols.map((col, i) => (
                        <td
                          key={col.key}
                          className={`py-2.5 px-2 whitespace-nowrap ${i === 0 ? "font-medium text-primary" : "text-right"} ${col.colorFn ? col.colorFn(s) : ""}`}
                        >
                          {i === 1 ? (
                            <span className="text-muted-foreground truncate max-w-[120px] block">{col.fmt(s)}</span>
                          ) : i === 2 ? (
                            <Badge variant="outline" className="text-xs">{col.fmt(s)}</Badge>
                          ) : (
                            col.fmt(s)
                          )}
                        </td>
                      ))}
                      <td
                        className="py-2.5 px-2 text-right"
                        onClick={e => { e.stopPropagation(); onToggleWatchlist(s.ticker) }}
                      >
                        <span className={`text-sm ${watchlist.includes(s.ticker) ? "text-yellow-400" : "text-muted-foreground hover:text-foreground"}`}>
                          {watchlist.includes(s.ticker) ? "★" : "☆"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length > 200 && (
                <p className="text-xs text-muted-foreground mt-3 text-center">
                  Showing top 200 results. Add filters to narrow down.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

