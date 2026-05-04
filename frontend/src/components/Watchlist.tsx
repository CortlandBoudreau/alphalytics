import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

type WatchlistStock = {
  ticker: string
  name: string
  price: number
  change: number
  marketCap: string
  peRatio: number | null
  grossMargin: number | null
  netMargin: number | null
  sector: string
}

type Props = {
  apiUrl: string
  apiToken: string
  watchlist: string[]
  onRemove: (ticker: string) => void
  onNavigate: (ticker: string) => void
}

function fmtPct(v: number | null) {
  if (v === null) return "—"
  return `${v.toFixed(1)}%`
}

export function Watchlist({ apiUrl, apiToken, watchlist, onRemove, onNavigate }: Props) {
  const [stocks, setStocks] = useState<Record<string, WatchlistStock>>({})
  const [loading, setLoading] = useState(false)

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiToken}`,
  }

  useEffect(() => {
    const toFetch = watchlist.filter((t) => !stocks[t])
    if (toFetch.length === 0) return

    setLoading(true)
    Promise.all(
      toFetch.map((t) =>
        fetch(`${apiUrl}/stock/${t}`, { headers })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    ).then((results) => {
      setStocks((prev) => {
        const next = { ...prev }
        results.forEach((data, i) => {
          if (data) next[toFetch[i]] = data
        })
        return next
      })
    }).finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist.join(",")])

  // Prune stocks removed from watchlist
  useEffect(() => {
    setStocks((prev) => {
      const next = { ...prev }
      for (const t of Object.keys(next)) {
        if (!watchlist.includes(t)) delete next[t]
      }
      return next
    })
  }, [watchlist])

  if (watchlist.length === 0) {
    return (
      <Card>
        <CardContent className="pt-16 pb-16 text-center">
          <svg className="mx-auto mb-5 opacity-20" width="64" height="64" viewBox="0 0 64 64" fill="none">
            <path d="M32 8L39.5 23.5L57 26.5L44.5 38.5L47.5 56L32 48L16.5 56L19.5 38.5L7 26.5L24.5 23.5L32 8Z"
              stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" className="text-primary" />
            <path d="M22 38L28 44L42 30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground" />
          </svg>
          <h3 className="text-base font-semibold mb-2">Your watchlist is empty</h3>
          <p className="text-muted-foreground text-sm max-w-xs mx-auto">
            Search for a stock in the <span className="text-foreground font-medium">Research</span> tab and click the <span className="text-yellow-400">★</span> to start tracking it here.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Watchlist
          <Badge variant="outline">{watchlist.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="text-left py-2 w-24">Ticker</th>
                <th className="text-left py-2">Name</th>
                <th className="text-right py-2 px-3">Price</th>
                <th className="text-right py-2 px-3">Change</th>
                <th className="text-right py-2 px-3">Mkt Cap</th>
                <th className="text-right py-2 px-3">P/E</th>
                <th className="text-right py-2 px-3">Gross Mg</th>
                <th className="text-right py-2 px-3">Net Mg</th>
                <th className="py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {watchlist.map((t) => {
                const s = stocks[t]
                if (!s) {
                  return (
                    <tr key={t} className="border-b border-border">
                      <td className="py-3 font-medium text-primary">{t}</td>
                      <td colSpan={6} className="py-3 text-muted-foreground text-xs">
                        {loading ? "Loading..." : "—"}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => onRemove(t)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="Remove from watchlist"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  )
                }
                return (
                  <tr
                    key={t}
                    className="border-b border-border hover:bg-secondary transition-colors cursor-pointer"
                    onClick={() => onNavigate(t)}
                  >
                    <td className="py-3 font-medium text-primary">{s.ticker}</td>
                    <td className="py-3 text-muted-foreground max-w-[160px] truncate">{s.name}</td>
                    <td className="py-3 px-3 text-right font-medium">${s.price.toFixed(2)}</td>
                    <td className={`py-3 px-3 text-right text-xs font-medium ${s.change >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {s.change >= 0 ? "▲" : "▼"} {Math.abs(s.change).toFixed(2)}%
                    </td>
                    <td className="py-3 px-3 text-right text-muted-foreground">{s.marketCap}</td>
                    <td className="py-3 px-3 text-right text-muted-foreground">
                      {s.peRatio != null ? s.peRatio.toFixed(1) : "—"}
                    </td>
                    <td className="py-3 px-3 text-right text-muted-foreground">{fmtPct(s.grossMargin)}</td>
                    <td className="py-3 px-3 text-right text-muted-foreground">{fmtPct(s.netMargin)}</td>
                    <td
                      className="py-3 px-3 text-right"
                      onClick={(e) => { e.stopPropagation(); onRemove(t) }}
                    >
                      <button
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="Remove from watchlist"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
