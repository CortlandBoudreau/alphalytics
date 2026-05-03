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
  forwardPE: number | null
  psRatio: number | null
  revenueGrowth: number | null
  epsGrowth: number | null
  grossMargin: number | null
  netMargin: number | null
  roe: number | null
  debtToEquity: number | null
}

type Props = {
  apiUrl: string
  apiToken: string
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

function fmtPct(v: number | null): string {
  if (v === null) return "—"
  return `${v.toFixed(1)}%`
}

function fmtRatio(v: number | null): string {
  if (v === null) return "—"
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

export function Screener({ apiUrl, apiToken }: Props) {
  const [allStocks, setAllStocks] = useState<Stock[]>([])
  const [loading, setLoading] = useState(false)
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("marketCapRaw")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  // Filters
  const [sector, setSector] = useState("All Sectors")
  const [marketCap, setMarketCap] = useState(0)
  const [minRevenueGrowth, setMinRevenueGrowth] = useState("")
  const [maxPE, setMaxPE] = useState("")
  const [maxForwardPE, setMaxForwardPE] = useState("")
  const [minNetMargin, setMinNetMargin] = useState("")
  const [minGrossMargin, setMinGrossMargin] = useState("")
  const [minEpsGrowth, setMinEpsGrowth] = useState("")

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiToken}`
  }

  const fetchData = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`${apiUrl}/screener/data`, { headers })
      if (res.status === 202) {
        setBuilding(true)
        setLoading(false)
        // Poll every 10s while building
        setTimeout(fetchData, 10000)
        return
      }
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.detail || "Failed to load screener data")
      }
      const data = await res.json()
      setAllStocks(data)
      setBuilding(false)
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
      if (minRevenueGrowth && (s.revenueGrowth === null || s.revenueGrowth < parseFloat(minRevenueGrowth))) return false
      if (maxPE && s.peRatio !== null && s.peRatio > parseFloat(maxPE)) return false
      if (maxForwardPE && s.forwardPE !== null && s.forwardPE > parseFloat(maxForwardPE)) return false
      if (minNetMargin && (s.netMargin === null || s.netMargin < parseFloat(minNetMargin))) return false
      if (minGrossMargin && (s.grossMargin === null || s.grossMargin < parseFloat(minGrossMargin))) return false
      if (minEpsGrowth && (s.epsGrowth === null || s.epsGrowth < parseFloat(minEpsGrowth))) return false
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
  }, [allStocks, sector, marketCap, minRevenueGrowth, maxPE, maxForwardPE, minNetMargin, minGrossMargin, minEpsGrowth, sortKey, sortDir])

  const resetFilters = () => {
    setSector("All Sectors")
    setMarketCap(0)
    setMinRevenueGrowth("")
    setMaxPE("")
    setMaxForwardPE("")
    setMinNetMargin("")
    setMinGrossMargin("")
    setMinEpsGrowth("")
  }

  const cols: { label: string; key: SortKey; fmt: (s: Stock) => string; colorFn?: (s: Stock) => string }[] = [
    { label: "Ticker",    key: "ticker",       fmt: s => s.ticker },
    { label: "Name",      key: "name",         fmt: s => s.name },
    { label: "Sector",    key: "sector",       fmt: s => s.sector },
    { label: "Price",     key: "price",        fmt: s => `$${s.price.toFixed(2)}` },
    { label: "Change",    key: "change",       fmt: s => `${s.change.toFixed(2)}%`, colorFn: s => s.change >= 0 ? "text-green-500" : "text-red-500" },
    { label: "Mkt Cap",   key: "marketCapRaw", fmt: s => s.marketCap },
    { label: "P/E",       key: "peRatio",      fmt: s => fmtRatio(s.peRatio) },
    { label: "Fwd P/E",   key: "forwardPE",    fmt: s => fmtRatio(s.forwardPE) },
    { label: "Rev Gr%",   key: "revenueGrowth",fmt: s => fmtPct(s.revenueGrowth), colorFn: s => s.revenueGrowth !== null ? (s.revenueGrowth >= 0 ? "text-green-500" : "text-red-500") : "" },
    { label: "EPS Gr%",   key: "epsGrowth",    fmt: s => fmtPct(s.epsGrowth),     colorFn: s => s.epsGrowth !== null ? (s.epsGrowth >= 0 ? "text-green-500" : "text-red-500") : "" },
    { label: "Gross Mg",  key: "grossMargin",  fmt: s => fmtPct(s.grossMargin) },
    { label: "Net Mg",    key: "netMargin",    fmt: s => fmtPct(s.netMargin),     colorFn: s => s.netMargin !== null ? (s.netMargin >= 0 ? "text-green-500" : "text-red-500") : "" },
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

            <FilterInput label="Min Revenue Growth (%)" placeholder="e.g. 10" value={minRevenueGrowth} onChange={setMinRevenueGrowth} />
            <FilterInput label="Max P/E Ratio" placeholder="e.g. 30" value={maxPE} onChange={setMaxPE} />
            <FilterInput label="Max Forward P/E" placeholder="e.g. 25" value={maxForwardPE} onChange={setMaxForwardPE} />
            <FilterInput label="Min Net Margin (%)" placeholder="e.g. 10" value={minNetMargin} onChange={setMinNetMargin} />
            <FilterInput label="Min Gross Margin (%)" placeholder="e.g. 40" value={minGrossMargin} onChange={setMinGrossMargin} />
            <FilterInput label="Min EPS Growth (%)" placeholder="e.g. 15" value={minEpsGrowth} onChange={setMinEpsGrowth} />
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
          {loading && !building && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground">Loading screener data for 300+ stocks...</p>
                <p className="text-xs text-muted-foreground mt-1">First load may take 1-2 minutes. Cached for 24 hours after.</p>
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

          {building && (
            <div className="text-center py-12 space-y-3">
              <div className="text-muted-foreground text-sm">
                Building screener data for {SP500_COUNT}+ stocks...
              </div>
              <div className="text-xs text-muted-foreground">This takes 2-3 minutes on first load, then caches for 24 hours.</div>
              <div className="flex justify-center gap-1 mt-4">
                {[0,1,2].map(i => (
                  <div key={i} className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-destructive text-sm">{error}</p>}

          {!loading && !building && allStocks.length > 0 && (
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
                    <tr key={s.ticker} className="border-b border-border hover:bg-secondary transition-colors">
                      {cols.map((col, i) => (
                        <td
                          key={col.key}
                          className={`py-2.5 px-2 whitespace-nowrap ${i === 0 ? "font-medium text-primary" : "text-right"} ${col.colorFn ? col.colorFn(s) : ""}`}
                        >
                          {i === 1 ? (
                            <span className="text-muted-foreground truncate max-w-[160px] block">{col.fmt(s)}</span>
                          ) : i === 2 ? (
                            <Badge variant="outline" className="text-xs">{col.fmt(s)}</Badge>
                          ) : (
                            col.fmt(s)
                          )}
                        </td>
                      ))}
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

// Constant for display only
const SP500_COUNT = 300
