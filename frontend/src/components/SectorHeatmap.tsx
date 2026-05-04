import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { apiFetch } from "@/lib/api"
import { RateLimitError } from "@/components/RateLimitError"

const SECTOR_ETFS = [
  { etf: "XLK",  label: "Technology" },
  { etf: "XLC",  label: "Comm. Services" },
  { etf: "XLV",  label: "Healthcare" },
  { etf: "XLF",  label: "Financials" },
  { etf: "XLY",  label: "Cons. Cyclical" },
  { etf: "XLP",  label: "Cons. Defensive" },
  { etf: "XLI",  label: "Industrials" },
  { etf: "XLE",  label: "Energy" },
  { etf: "XLRE", label: "Real Estate" },
  { etf: "XLB",  label: "Materials" },
  { etf: "XLU",  label: "Utilities" },
]

type Quote = { ticker: string; name: string; price: number; change: number }

type Props = { apiUrl: string; apiToken: string }

function heatBg(change: number): string {
  const t = Math.min(Math.abs(change) / 2.5, 1) // 2.5% = full intensity
  if (change >= 0) {
    const g = Math.round(80 + t * 105)
    const rb = Math.round(20 - t * 10)
    return `rgb(${rb}, ${g}, ${rb})`
  } else {
    const r = Math.round(80 + t * 115)
    const gb = Math.round(20 - t * 10)
    return `rgb(${r}, ${gb}, ${gb})`
  }
}

function textColor(change: number): string {
  return Math.abs(change) > 1.2 ? "text-white" : change >= 0 ? "text-green-300" : "text-red-300"
}

export function SectorHeatmap({ apiUrl, apiToken }: Props) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ kind: "message"; text: string } | { kind: "rate_limit"; retryAfter: number } | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const tickers = [...SECTOR_ETFS.map(s => s.etf), "SPY", "QQQ", "DIA", "IWM"].join(",")

  const fetchQuotes = async () => {
    setLoading(true)
    setError(null)
    const result = await apiFetch<Record<string, Quote>>(
      `${apiUrl}/quotes?tickers=${encodeURIComponent(tickers)}`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    )
    setLoading(false)
    if (!result.ok) {
      const err = result.error
      if (err.kind === "rate_limit") {
        setError({ kind: "rate_limit", retryAfter: err.retryAfter })
      } else {
        setError({ kind: "message", text: err.detail ?? "Failed to load market data" })
      }
      return
    }
    setQuotes(result.data)
    setLastUpdated(new Date())
  }

  useEffect(() => { fetchQuotes() }, [])

  // Sort by change descending for visual impact
  const sorted = [...SECTOR_ETFS].sort((a, b) => {
    const ac = quotes[a.etf]?.change ?? 0
    const bc = quotes[b.etf]?.change ?? 0
    return bc - ac
  })

  const spyChange = quotes["SPY"]?.change ?? null

  return (
    <div className="space-y-6">
      {/* Market summary bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {["SPY", "QQQ", "DIA", "IWM"].map(etf => {
          const q = quotes[etf]
          return (
            <Card key={etf}>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">{
                  etf === "SPY" ? "S&P 500" : etf === "QQQ" ? "Nasdaq 100" : etf === "DIA" ? "Dow Jones" : "Russell 2000"
                }</p>
                {q ? (
                  <>
                    <p className="text-lg font-bold mt-1">${q.price.toFixed(2)}</p>
                    <p className={`text-sm font-medium ${q.change >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {q.change >= 0 ? "▲" : "▼"} {Math.abs(q.change).toFixed(2)}%
                    </p>
                  </>
                ) : (
                  <div className="h-10 mt-1 rounded bg-secondary animate-pulse" />
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {error && error.kind === "rate_limit" && (
        <RateLimitError
          retryAfter={error.retryAfter}
          onRetry={fetchQuotes}
          message="Market data rate limited."
        />
      )}
      {error && error.kind === "message" && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
          <span className="text-destructive text-sm mt-0.5">⚠</span>
          <div className="flex-1">
            <p className="text-sm text-destructive font-medium">{error.text}</p>
            <button
              onClick={fetchQuotes}
              className="text-xs text-muted-foreground hover:text-foreground mt-1 underline transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Sector heatmap */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Sector Performance
            <div className="flex items-center gap-3">
              {lastUpdated && (
                <span className="text-xs text-muted-foreground">
                  {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
              <button
                onClick={fetchQuotes}
                disabled={loading}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {sorted.map(({ etf, label }) => {
              const q = quotes[etf]
              const change = q?.change ?? null
              return (
                <div
                  key={etf}
                  className="rounded-lg p-4 flex flex-col justify-between min-h-[90px] transition-transform hover:scale-[1.02]"
                  style={{ backgroundColor: change != null ? heatBg(change) : "#1a1a1a" }}
                >
                  <div>
                    <p className={`text-xs font-medium opacity-80 ${change != null ? textColor(change) : "text-muted-foreground"}`}>
                      {label}
                    </p>
                    <p className={`text-xs opacity-60 ${change != null ? textColor(change) : "text-muted-foreground"}`}>
                      {etf}
                    </p>
                  </div>
                  {change != null ? (
                    <p className={`text-2xl font-bold ${textColor(change)}`}>
                      {change >= 0 ? "+" : ""}{change.toFixed(2)}%
                    </p>
                  ) : (
                    <div className="h-7 w-20 rounded bg-white/10 animate-pulse mt-2" />
                  )}
                </div>
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center justify-center gap-6 mt-5">
            <div className="flex items-center gap-1.5">
              <div className="flex gap-0.5">
                {[-2.5,-1.5,-0.5].map(v => (
                  <div key={v} className="w-4 h-3 rounded-sm" style={{ backgroundColor: heatBg(v) }} />
                ))}
              </div>
              <span className="text-xs text-muted-foreground">Decline</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex gap-0.5">
                {[0.5,1.5,2.5].map(v => (
                  <div key={v} className="w-4 h-3 rounded-sm" style={{ backgroundColor: heatBg(v) }} />
                ))}
              </div>
              <span className="text-xs text-muted-foreground">Advance</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
