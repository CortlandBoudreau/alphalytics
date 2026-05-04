import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ComposedChart, Area, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { Compare } from "@/components/Compare"
import { Financials } from "@/components/Financials"
import { Landing } from "@/components/Landing"
import { CanvasBackground } from "@/components/CanvasBackground"
import { Portfolio } from "@/components/Portfolio"
import { Screener } from "@/components/Screener"
import { StockNews } from "@/components/StockNews"
import { Watchlist } from "@/components/Watchlist"

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
  description: string
  sector: string
  industry: string
  ttmEpsGrowth: number | null
  ttmRevenueGrowth: number | null
  grossMargin: number | null
  netMargin: number | null
  ttmPsRatio: number | null
  chartData: { date: string; price: number; volume: number; ma50: number | null; ma200: number | null }[]
  revenueData: { quarter: string; revenue: number }[]
}

type Analysis = {
  summary: string
  bull_case: string[]
  bear_case: string[]
  sentiment: "bullish" | "bearish" | "neutral"
  disclaimer: string
}

type Tab = "research" | "income" | "screener" | "compare" | "watchlist" | "portfolio"

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
const API_TOKEN = import.meta.env.VITE_API_SECRET_TOKEN

const headers = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${API_TOKEN}`
}

const fmtPercent = (v: number | null) => v != null ? `${v.toFixed(2)}%` : "N/A"
const fmtRatio = (v: number | null) => v != null ? v.toFixed(2) : "N/A"

function App() {
  const [showLanding, setShowLanding] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>("research")
  const [ticker, setTicker] = useState("")
  const [stock, setStock] = useState<StockData | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [error, setError] = useState("")
  const [allTickers, setAllTickers] = useState<{ ticker: string; name: string }[]>([])
  const [suggestions, setSuggestions] = useState<{ ticker: string; name: string }[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [chartTab, setChartTab] = useState<"price" | "revenue">("price")
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("alphalytics_watchlist") || "[]") }
    catch { return [] }
  })

  useEffect(() => {
    const fetchTickers = async () => {
      try {
        const response = await fetch(`${API_URL}/tickers`, { headers })
        const data = await response.json()
        setAllTickers(data)
      } catch (err) {
        console.error("Failed to load tickers")
      }
    }
    fetchTickers()
  }, [])

  const handleTickerChange = (val: string) => {
    const upper = val.toUpperCase()
    setTicker(upper)

    if (upper.length < 1) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    const tickerMatches = allTickers.filter(t => t.ticker.startsWith(upper)).slice(0, 6)
    const nameMatches = allTickers
      .filter(t => !t.ticker.startsWith(upper) && t.name.toUpperCase().startsWith(upper))
      .slice(0, 2)

    setSuggestions([...tickerMatches, ...nameMatches])
    setShowSuggestions(true)
  }

  const handleSearch = async (overrideTicker?: string) => {
    const searchTicker = overrideTicker || ticker
    if (!searchTicker.trim()) return
    setLoading(true)
    setError("")
    setStock(null)
    setAnalysis(null)

    try {
      const response = await fetch(`${API_URL}/stock/${searchTicker}`, { headers })
      const data = await response.json()
      if (!response.ok) {
        setError(data.detail || "Stock not found")
        return
      }
      setStock(data)
    } catch (err) {
      setError("Failed to connect to API")
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyze = async () => {
    if (!stock) return
    setAnalysisLoading(true)

    try {
      const response = await fetch(`${API_URL}/analyze`, {
        method: "POST",
        headers,
        body: JSON.stringify(stock)
      })
      const data = await response.json()
      setAnalysis(data)
    } catch (err) {
      setError("Failed to get analysis")
    } finally {
      setAnalysisLoading(false)
    }
  }

  useEffect(() => {
    localStorage.setItem("alphalytics_watchlist", JSON.stringify(watchlist))
  }, [watchlist])

  const toggleWatchlist = (t: string) => {
    setWatchlist((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])
  }

  const handleWatchlistNavigate = (t: string) => {
    setTicker(t)
    setActiveTab("research")
    handleSearch(t)
  }

  const sentimentColor = {
    bullish: "text-green-500",
    bearish: "text-red-500",
    neutral: "text-yellow-500"
  }

  const NAV_TABS: { key: Tab; label: string }[] = [
    { key: "research",  label: "Research" },
    { key: "income",    label: "Income" },
    { key: "screener",  label: "Screener" },
    { key: "compare",   label: "Compare" },
    { key: "watchlist", label: `Watchlist${watchlist.length > 0 ? ` (${watchlist.length})` : ""}` },
    { key: "portfolio", label: "Portfolio" },
  ]

  if (showLanding) {
    return <Landing onEnter={() => setShowLanding(false)} />
  }

  return (
    <div className="min-h-screen bg-background">
      <CanvasBackground />

      {/* Top Nav */}
      <div className="border-b border-border bg-background sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-8">
          <div className="flex items-center gap-8 h-14">
            <span className="text-lg font-bold text-primary shrink-0">Alphalytics</span>
            <nav className="flex items-center gap-1">
              {NAV_TABS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    activeTab === key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-8 py-8 space-y-6">

        {/* Research Tab */}
        {activeTab === "research" && (
          <>
            <Card className="overflow-visible">
              <CardContent className="pt-6 overflow-visible">
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder="Search ticker or company name..."
                      value={ticker}
                      onChange={(e) => handleTickerChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setShowSuggestions(false)
                          handleSearch()
                        }
                        if (e.key === "Escape") setShowSuggestions(false)
                      }}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                      className="w-full px-4 py-2 rounded-md bg-secondary border border-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {showSuggestions && suggestions.length > 0 && (
                      <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border rounded-md shadow-lg overflow-hidden">
                        {suggestions.map((s) => (
                          <button
                            key={s.ticker}
                            className="w-full text-left px-4 py-2 text-sm hover:bg-secondary transition-colors flex items-center justify-between"
                            onMouseDown={() => {
                              setTicker(s.ticker)
                              setShowSuggestions(false)
                              handleSearch(s.ticker)
                            }}
                          >
                            <span className="font-medium text-primary">{s.ticker}</span>
                            <span className="text-muted-foreground text-xs truncate ml-3">{s.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleSearch()}
                    disabled={loading || !ticker.trim()}
                    className="px-6 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {loading ? "Loading..." : "Search"}
                  </button>
                </div>
                {error && <p className="text-destructive text-sm mt-2">{error}</p>}
              </CardContent>
            </Card>

            {stock && (
              <>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-3">
                          <h2 className="text-2xl font-bold">{stock.ticker}</h2>
                          <Badge variant="outline">{stock.sector}</Badge>
                          <button
                            onClick={() => toggleWatchlist(stock.ticker)}
                            className="text-xl leading-none hover:scale-110 transition-transform"
                            title={watchlist.includes(stock.ticker) ? "Remove from watchlist" : "Add to watchlist"}
                          >
                            {watchlist.includes(stock.ticker) ? "★" : "☆"}
                          </button>
                        </div>
                        <p className="text-muted-foreground">{stock.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-bold">${stock.price.toFixed(2)}</p>
                        <p className={stock.change >= 0 ? "text-green-500" : "text-red-500"}>
                          {stock.change >= 0 ? "▲" : "▼"} {Math.abs(stock.change).toFixed(2)}%
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                      {[
                        { label: "Market Cap",   value: stock.marketCap },
                        { label: "TTM P/E",      value: fmtRatio(stock.peRatio) },
                        { label: "Forward P/E",  value: fmtRatio(stock.forwardPE) },
                        { label: "TTM P/S",      value: fmtRatio(stock.ttmPsRatio) },
                        { label: "Gross Margin", value: fmtPercent(stock.grossMargin) },
                        { label: "Net Margin",   value: fmtPercent(stock.netMargin) },
                        { label: "EPS Growth",   value: fmtPercent(stock.ttmEpsGrowth) },
                        { label: "Rev Growth",   value: fmtPercent(stock.ttmRevenueGrowth) },
                        { label: "52W High",     value: `$${stock.weekHigh52}` },
                        { label: "52W Low",      value: `$${stock.weekLow52}` },
                      ].map((metric) => (
                        <div key={metric.label} className="bg-secondary rounded-md p-3">
                          <p className="text-xs text-muted-foreground">{metric.label}</p>
                          <p className="text-lg font-semibold mt-1">{metric.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* 52W Range bar */}
                    {stock.weekHigh52 > stock.weekLow52 && (() => {
                      const pct = Math.max(0, Math.min(100,
                        (stock.price - stock.weekLow52) / (stock.weekHigh52 - stock.weekLow52) * 100
                      ))
                      return (
                        <div className="mt-5 space-y-1.5">
                          <p className="text-xs text-muted-foreground">52W Range</p>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground w-16 text-right shrink-0">${stock.weekLow52.toFixed(2)}</span>
                            <div className="relative flex-1 h-1.5 bg-secondary rounded-full">
                              <div className="absolute inset-y-0 left-0 bg-primary/30 rounded-full" style={{ width: `${pct}%` }} />
                              <div
                                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-primary rounded-full border-2 border-background shadow"
                                style={{ left: `calc(${pct}% - 6px)` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground w-16 shrink-0">${stock.weekHigh52.toFixed(2)}</span>
                          </div>
                        </div>
                      )
                    })()}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      Charts
                      <div className="flex gap-1">
                        {(["price", "revenue"] as const).map((t) => (
                          <button
                            key={t}
                            onClick={() => setChartTab(t)}
                            className={`px-3 py-1 rounded-md text-sm font-medium capitalize transition-colors ${
                              chartTab === t
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {chartTab === "price" && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                          <span className="flex items-center gap-1.5"><span className="inline-block w-6 h-0.5 bg-blue-500" />Price</span>
                          <span className="flex items-center gap-1.5"><span className="inline-block w-6 h-0.5 bg-amber-400" />MA50</span>
                          <span className="flex items-center gap-1.5"><span className="inline-block w-6 h-0.5 bg-red-500" />MA200</span>
                        </div>
                        <ResponsiveContainer width="100%" height={240}>
                          <ComposedChart data={stock.chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
                            <XAxis dataKey="date" stroke="#888888" tick={{ fontSize: 11 }} interval={Math.floor(stock.chartData.length / 7)} />
                            <YAxis stroke="#888888" tick={{ fontSize: 11 }} domain={["auto", "auto"]} width={55} tickFormatter={(v) => `$${v}`} />
                            <Tooltip
                              contentStyle={{ backgroundColor: "#111111", border: "1px solid #333" }}
                              formatter={(value, name) => {
                                const labels: Record<string, string> = { price: "Price", ma50: "MA 50", ma200: "MA 200" }
                                const n = Number(value)
                                return [`$${n.toFixed(2)}`, labels[String(name)] ?? String(name)]
                              }}
                            />
                            <Area type="monotone" dataKey="price" stroke="#3b82f6" fill="url(#priceGradient)" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="ma50" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls />
                            <Line type="monotone" dataKey="ma200" stroke="#ef4444" strokeWidth={1.5} dot={false} connectNulls />
                          </ComposedChart>
                        </ResponsiveContainer>
                        <ResponsiveContainer width="100%" height={60}>
                          <BarChart data={stock.chartData} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
                            <XAxis dataKey="date" hide />
                            <YAxis stroke="#888888" tick={{ fontSize: 10 }} width={55} tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`} tickCount={2} />
                            <Tooltip
                              contentStyle={{ backgroundColor: "#111111", border: "1px solid #333" }}
                              formatter={(value) => [`${(Number(value) / 1e6).toFixed(1)}M`, "Volume"]}
                            />
                            <Bar dataKey="volume" fill="#3b82f6" opacity={0.4} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    {chartTab === "revenue" && (
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={stock.revenueData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
                          <XAxis dataKey="quarter" stroke="#888888" tick={{ fontSize: 12 }} />
                          <YAxis stroke="#888888" tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v/1e9).toFixed(0)}B`} />
                          <Tooltip
                            contentStyle={{ backgroundColor: "#111111", border: "1px solid #1f1f1f" }}
                            formatter={(value) => [`$${(Number(value)/1e9).toFixed(2)}B`, "Revenue"]}
                          />
                          <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      AI Analysis
                      {!analysis && (
                        <button
                          onClick={handleAnalyze}
                          disabled={analysisLoading}
                          className="text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                        >
                          {analysisLoading ? "Analysing..." : "Generate Analysis"}
                        </button>
                      )}
                      {analysis && (
                        <span className={`text-sm font-medium capitalize ${sentimentColor[analysis.sentiment]}`}>
                          {analysis.sentiment}
                        </span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {!analysis && !analysisLoading && (
                      <p className="text-muted-foreground text-sm">Click Generate Analysis for an AI-powered bull/bear breakdown.</p>
                    )}
                    {analysisLoading && (
                      <p className="text-muted-foreground text-sm">Analysing {stock.ticker}...</p>
                    )}
                    {analysis && (
                      <div className="space-y-4">
                        <p className="text-muted-foreground">{analysis.summary}</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-secondary rounded-md p-4">
                            <p className="text-green-500 font-medium mb-2">🐂 Bull Case</p>
                            <ul className="space-y-1">
                              {analysis.bull_case.map((point, i) => (
                                <li key={i} className="text-sm text-muted-foreground">• {point}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="bg-secondary rounded-md p-4">
                            <p className="text-red-500 font-medium mb-2">🐻 Bear Case</p>
                            <ul className="space-y-1">
                              {analysis.bear_case.map((point, i) => (
                                <li key={i} className="text-sm text-muted-foreground">• {point}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground border-t border-border pt-3">{analysis.disclaimer}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>About {stock.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground text-sm">{stock.description}</p>
                    <div className="flex gap-2 mt-3">
                      <Badge variant="outline">{stock.sector}</Badge>
                      <Badge variant="outline">{stock.industry}</Badge>
                    </div>
                  </CardContent>
                </Card>

                <StockNews ticker={stock.ticker} apiUrl={API_URL} apiToken={API_TOKEN} />
              </>
            )}
          </>
        )}

        {/* Income Tab */}
        {activeTab === "income" && (
          <Financials apiUrl={API_URL} apiToken={API_TOKEN} allTickers={allTickers} />
        )}

        {/* Compare Tab */}
        {activeTab === "compare" && (
          <Compare apiUrl={API_URL} apiToken={API_TOKEN} allTickers={allTickers} />
        )}

        {/* Screener Tab */}
        {activeTab === "screener" && (
          <Screener
            apiUrl={API_URL}
            apiToken={API_TOKEN}
            watchlist={watchlist}
            onNavigate={handleWatchlistNavigate}
            onToggleWatchlist={toggleWatchlist}
          />
        )}

        {/* Watchlist Tab */}
        {activeTab === "watchlist" && (
          <Watchlist
            apiUrl={API_URL}
            apiToken={API_TOKEN}
            watchlist={watchlist}
            onRemove={toggleWatchlist}
            onNavigate={handleWatchlistNavigate}
          />
        )}

        {/* Portfolio Tab */}
        {activeTab === "portfolio" && (
          <Portfolio apiUrl={API_URL} apiToken={API_TOKEN} allTickers={allTickers} />
        )}
      </div>
    </div>
  )
}

export default App