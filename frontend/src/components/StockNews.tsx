import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type NewsItem = {
  title: string
  publisher: string
  url: string
  publishedAt: string | number
  thumbnail: string | null
}

type Props = { ticker: string; apiUrl: string; apiToken: string }

function timeAgo(val: string | number): string {
  const ms = typeof val === "number" ? val * 1000 : new Date(val as string).getTime()
  if (!ms || isNaN(ms)) return ""
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function StockNews({ ticker, apiUrl, apiToken }: Props) {
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    setNews([])
    fetch(`${apiUrl}/news/${ticker}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    })
      .then(r => (r.ok ? r.json() : []))
      .then(setNews)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [ticker])

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>News</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4 animate-pulse">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex gap-3">
                <div className="w-16 h-12 rounded bg-secondary shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3 bg-secondary rounded w-full" />
                  <div className="h-3 bg-secondary rounded w-4/5" />
                  <div className="h-2 bg-secondary rounded w-1/4 mt-1" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!news.length) return null

  return (
    <Card>
      <CardHeader><CardTitle>News</CardTitle></CardHeader>
      <CardContent>
        <div className="divide-y divide-border">
          {news.map((item, i) => (
            <a
              key={i}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-3 py-3 first:pt-0 last:pb-0 hover:opacity-75 transition-opacity group"
            >
              {item.thumbnail && (
                <img
                  src={item.thumbnail}
                  alt=""
                  className="w-16 h-12 object-cover rounded bg-secondary shrink-0"
                  onError={e => { e.currentTarget.style.display = "none" }}
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                  {item.title}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {item.publisher}{item.publisher && timeAgo(item.publishedAt) ? " · " : ""}{timeAgo(item.publishedAt)}
                </p>
              </div>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
