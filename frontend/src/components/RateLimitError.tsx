import { useState, useEffect } from "react"

type Props = {
  retryAfter: number   // seconds to wait
  onRetry: () => void  // called when countdown hits 0 or user clicks
  message?: string
}

export function RateLimitError({ retryAfter, onRetry, message }: Props) {
  const [remaining, setRemaining] = useState(retryAfter)

  useEffect(() => {
    setRemaining(retryAfter)
  }, [retryAfter])

  useEffect(() => {
    if (remaining <= 0) {
      onRetry()
      return
    }
    const t = setTimeout(() => setRemaining(r => r - 1), 1000)
    return () => clearTimeout(t)
  }, [remaining])

  const pct = Math.round((remaining / retryAfter) * 100)

  return (
    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-yellow-400 text-sm">⏱</span>
          <p className="text-sm font-medium text-yellow-400">Rate limited</p>
        </div>
        <button
          onClick={onRetry}
          className="text-xs text-yellow-400 hover:text-yellow-300 underline transition-colors"
        >
          Retry now
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {message || "Too many requests."} Auto-retrying in <span className="text-foreground font-medium">{remaining}s</span>
      </p>
      {/* Progress bar — drains as countdown ticks */}
      <div className="h-1 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full bg-yellow-500/60 rounded-full transition-all duration-1000"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
