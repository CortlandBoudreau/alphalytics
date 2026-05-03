import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

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
  const [error, setError] = useState("")
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

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiToken}`
  }

  const fetchData = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`${apiUrl}/screener/data`, { headers })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.detail || "Failed to load screener data")
      }
      const data = await res.json()
      setAllStocks(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
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
  }

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
        <CardContent>
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
            <FilterInput label="Min Beta"          placeholder="e.g. 0.5" value={minBeta}     onChange={setMinBeta} />
            <FilterInput label="Max Beta"          placeholder="e.g. 1.5" value={maxBeta}     onChange={setMaxBeta} />
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
              <button
                onClick={fetchData}
                disabled={loading}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                Refresh data
              </button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground">Loading screener data...</p>
                <p className="text-xs text-muted-foreground mt-1">First load fetches live data and caches for 24 hours.</p>
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

          {error && <p className="text-destructive text-sm">{error}</p>}

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

