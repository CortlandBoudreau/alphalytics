import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

type StockData = {
  ticker: string
  name: string
  price: number
  change: number
  marketCap: string
  peRatio: number | null
  forwardPE: number | null
  weekHigh52: number
  weekLow52: number
  volume: string
  sector: string
  ttmEpsGrowth: number | null
  ttmRevenueGrowth: number | null
  grossMargin: number | null
  netMargin: number | null
  ttmPsRatio: number | null
}

type Props = {
  apiUrl: string
  apiToken: string
  allTickers: { ticker: string; name: string }[]
}

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b"]

type MetricDef = {
  label: string
  key: keyof StockData
  format: (v: never) => string
  color?: (v: number) => string
}

type MetricGroup = {
  group: string
  metrics: MetricDef[]
}

const fmt = {
  dollar: (v: number) => v != null ? `$${v.toFixed(2)}` : "N/A",
  percent: (v: number) => v != null ? `${v.toFixed(2)}%` : "N/A",
  ratio: (v: number | string | null) => v != null ? String(v) : "N/A",
  percentColor: (v: number) => v >= 0 ? "text-green-500" : "text-red-500",
}

const METRIC_GROUPS: MetricGroup[] = [
  {
    group: "Price",
    metrics: [
      { label: "Price", key: "price", format: fmt.dollar as never },
      { label: "Change", key: "change", format: fmt.percent as never, color: fmt.percentColor },
      { label: "Market Cap", key: "marketCap", format: fmt.ratio as never },
    ],
  },
  {
    group: "Valuation",
    metrics: [
      { label: "TTM P/E", key: "peRatio", format: fmt.ratio as never },
      { label: "Forward P/E", key: "forwardPE", format: fmt.ratio as never },
      { label: "TTM P/S", key: "ttmPsRatio", format: fmt.ratio as never },
    ],
  },
  {
    group: "Growth",
    metrics: [
      { label: "TTM EPS Growth", key: "ttmEpsGrowth", format: fmt.percent as never, color: fmt.percentColor },
      { label: "TTM Revenue Growth", key: "ttmRevenueGrowth", format: fmt.percent as never, color: fmt.percentColor },
    ],
  },
  {
    group: "Margins",
    metrics: [
      { label: "Gross Margin", key: "grossMargin", format: fmt.percent as never },
      { label: "Net Margin", key: "netMargin", format: fmt.percent as never },
    ],
  },
  {
    group: "52-Week Range",
    metrics: [
      { label: "52W High", key: "weekHigh52", format: fmt.dollar as never },
      { label: "52W Low", key: "weekLow52", format: fmt.dollar as never },
    ],
  },
]

export function Compare({ apiUrl, apiToken, allTickers }: Props) {
  const [tickers, setTickers] = useState(["", "", ""])
  const [stocks, setStocks] = useState<(StockData | null)[]>([null, null, null])
  const [loading, setLoading] = useState<boolean[]>([false, false, false])
  const [errors, setErrors] = useState<string[]>(["", "", ""])
  const [suggestions, setSuggestions] = useState<{ ticker: string; name: string }[][]>([[], [], []])
  const [showSuggestions, setShowSuggestions] = useState<boolean[]>([false, false, false])

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiToken}`
  }

  const handleTickerChange = (val: string, index: number) => {
    const upper = val.toUpperCase()
    const t = [...tickers]
    t[index] = upper
    setTickers(t)

    if (upper.length < 1) {
      const s = [...suggestions]
      s[index] = []
      setSuggestions(s)
      return
    }

    const tickerMatches = allTickers
      .filter(t => t.ticker.startsWith(upper))
      .slice(0, 6)

    const nameMatches = allTickers
      .filter(t => !t.ticker.startsWith(upper) && t.name.toUpperCase().startsWith(upper))
      .slice(0, 2)

    const s = [...suggestions]
    s[index] = [...tickerMatches, ...nameMatches]
    setSuggestions(s)

    const show = [...showSuggestions]
    show[index] = true
    setShowSuggestions(show)
  }

  const fetchStock = async (index: number, overrideTicker?: string) => {
    const ticker = overrideTicker || tickers[index]
    if (!ticker.trim()) return

    const newLoading = [...loading]
    newLoading[index] = true
    setLoading(newLoading)

    const newErrors = [...errors]
    newErrors[index] = ""
    setErrors(newErrors)

    try {
      const response = await fetch(`${apiUrl}/stock/${ticker}`, { headers })
      const data = await response.json()

      if (!response.ok) {
        newErrors[index] = data.detail || "Not found"
        setErrors([...newErrors])
        return
      }

      const newStocks = [...stocks]
      newStocks[index] = data
      setStocks(newStocks)
    } catch {
      newErrors[index] = "Failed to fetch"
      setErrors([...newErrors])
    } finally {
      const nl = [...loading]
      nl[index] = false
      setLoading(nl)
    }
  }

  const activeStocks = stocks.filter(Boolean) as StockData[]

  return (
    <div className="space-y-6">
      <Card className="overflow-visible">
        <CardHeader>
          <CardTitle>Compare Stocks</CardTitle>
        </CardHeader>
        <CardContent className="overflow-visible">
          <div className="grid grid-cols-3 gap-3">
            {tickers.map((ticker, i) => (
              <div key={i} className="space-y-1 relative">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder={`Ticker ${i + 1}`}
                      value={ticker}
                      onChange={(e) => handleTickerChange(e.target.value, i)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const show = [...showSuggestions]
                          show[i] = false
                          setShowSuggestions(show)
                          fetchStock(i)
                        }
                      }}
                      onBlur={() => setTimeout(() => {
                        const show = [...showSuggestions]
                        show[i] = false
                        setShowSuggestions(show)
                      }, 150)}
                      className="w-full px-3 py-2 rounded-md bg-secondary border border-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                    />
                    {showSuggestions[i] && suggestions[i].length > 0 && (
                      <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border rounded-md shadow-lg overflow-hidden">
                        {suggestions[i].map((s) => (
                          <button
                            key={s.ticker}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors flex items-center justify-between"
                            onMouseDown={() => {
                              const t = [...tickers]
                              t[i] = s.ticker
                              setTickers(t)
                              const show = [...showSuggestions]
                              show[i] = false
                              setShowSuggestions(show)
                              fetchStock(i, s.ticker)
                            }}
                          >
                            <span className="font-medium" style={{ color: COLORS[i] }}>{s.ticker}</span>
                            <span className="text-muted-foreground text-xs truncate ml-3">{s.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => fetchStock(i)}
                    disabled={loading[i] || !ticker.trim()}
                    className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:opacity-90 disabled:opacity-50"
                  >
                    {loading[i] ? "..." : "Add"}
                  </button>
                </div>
                {errors[i] && <p className="text-destructive text-xs">{errors[i]}</p>}
                {stocks[i] && (
                  <p className="text-xs text-muted-foreground" style={{ color: COLORS[i] }}>
                    ● {stocks[i]!.name}
                  </p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {activeStocks.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Metrics Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 text-muted-foreground">Metric</th>
                      {activeStocks.map((s, i) => (
                        <th key={i} className="text-right py-2 font-medium" style={{ color: COLORS[stocks.indexOf(s)] }}>
                          {s.ticker}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {METRIC_GROUPS.map((group) => (
                      <>
                        <tr key={`group-${group.group}`}>
                          <td
                            colSpan={activeStocks.length + 1}
                            className="pt-4 pb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground"
                          >
                            {group.group}
                          </td>
                        </tr>
                        {group.metrics.map((metric) => (
                          <tr
                            key={metric.label}
                            className="border-b border-border hover:bg-secondary transition-colors"
                          >
                            <td className="py-3 text-muted-foreground pl-2">{metric.label}</td>
                            {activeStocks.map((s, i) => {
                              const val = s[metric.key]
                              const formatted = val != null ? metric.format(val as never) : "N/A"
                              const colorClass = metric.color && val != null ? metric.color(val as number) : ""
                              return (
                                <td key={i} className={`py-3 text-right font-medium ${colorClass}`}>
                                  {formatted}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex gap-3 flex-wrap">
                {activeStocks.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[stocks.indexOf(s)] }} />
                    <span className="font-medium">{s.ticker}</span>
                    <Badge variant="outline">{s.sector}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
