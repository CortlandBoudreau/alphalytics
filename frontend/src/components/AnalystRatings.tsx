import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type Props = {
  price: number
  analystCount: number | null
  recommendationKey: string | null
  recommendationMean: number | null
  targetHigh: number | null
  targetLow: number | null
  targetMean: number | null
  targetMedian: number | null
}

const CONSENSUS: Record<string, { label: string; color: string; score: number }> = {
  strong_buy:  { label: "Strong Buy",  color: "text-emerald-400", score: 5 },
  buy:         { label: "Buy",         color: "text-green-500",   score: 4 },
  hold:        { label: "Hold",        color: "text-yellow-400",  score: 3 },
  sell:        { label: "Sell",        color: "text-orange-400",  score: 2 },
  strong_sell: { label: "Strong Sell", color: "text-red-500",     score: 1 },
  underperform:{ label: "Underperform",color: "text-orange-400",  score: 2 },
  underweight: { label: "Underweight", color: "text-orange-400",  score: 2 },
  overweight:  { label: "Overweight",  color: "text-green-500",   score: 4 },
  outperform:  { label: "Outperform",  color: "text-green-500",   score: 4 },
  neutral:     { label: "Neutral",     color: "text-yellow-400",  score: 3 },
}

// yfinance recommendationMean: 1=Strong Buy, 2=Buy, 3=Hold, 4=Sell, 5=Strong Sell
const SCORE_LABELS = ["", "Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"]

export function AnalystRatings({ price, analystCount, recommendationKey, recommendationMean, targetHigh, targetLow, targetMean, targetMedian }: Props) {
  if (!analystCount && !recommendationKey) return null

  const consensus = recommendationKey ? CONSENSUS[recommendationKey.toLowerCase()] : null
  const hasTargets = targetLow != null && targetHigh != null && targetHigh > targetLow

  // Position of current price on the target range bar
  const pricePct = hasTargets
    ? Math.max(0, Math.min(100, ((price - targetLow!) / (targetHigh! - targetLow!)) * 100))
    : null

  // Position of mean target on the bar
  const meanPct = hasTargets && targetMean != null
    ? Math.max(0, Math.min(100, ((targetMean - targetLow!) / (targetHigh! - targetLow!)) * 100))
    : null

  // Mean upside/downside from current price
  const upside = targetMean != null && price > 0
    ? ((targetMean - price) / price) * 100
    : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analyst Ratings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Consensus row */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Consensus</p>
            {consensus ? (
              <p className={`text-2xl font-bold ${consensus.color}`}>{consensus.label}</p>
            ) : (
              <p className="text-2xl font-bold text-muted-foreground">—</p>
            )}
            {analystCount != null && (
              <p className="text-xs text-muted-foreground mt-0.5">{analystCount} analysts</p>
            )}
          </div>

          {/* Mean score meter (1–5) */}
          {recommendationMean != null && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground mb-1">Mean Score</p>
              <p className="text-2xl font-bold">{recommendationMean.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">{SCORE_LABELS[Math.round(recommendationMean)] ?? ""}</p>
            </div>
          )}
        </div>

        {/* Price target range bar */}
        {hasTargets && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Price Target Range</p>
              {upside != null && (
                <p className={`text-xs font-medium ${upside >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {upside >= 0 ? "+" : ""}{upside.toFixed(1)}% to mean
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-16 text-right shrink-0">${targetLow!.toFixed(2)}</span>
              <div className="relative flex-1 h-1.5 bg-secondary rounded-full">
                {/* Mean marker (diamond shape via rotated square) */}
                {meanPct != null && (
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-primary/60 rotate-45 rounded-sm"
                    style={{ left: `calc(${meanPct}% - 5px)` }}
                    title={`Mean target: $${targetMean?.toFixed(2)}`}
                  />
                )}
                {/* Current price dot */}
                {pricePct != null && (
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full border-2 border-background shadow z-10"
                    style={{ left: `calc(${pricePct}% - 6px)` }}
                    title={`Current: $${price.toFixed(2)}`}
                  />
                )}
              </div>
              <span className="text-xs text-muted-foreground w-16 shrink-0">${targetHigh!.toFixed(2)}</span>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 bg-white rounded-full border border-muted shrink-0" />
                Current ${price.toFixed(2)}
              </span>
              {targetMean != null && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 bg-primary/60 rotate-45 shrink-0" />
                  Mean ${targetMean.toFixed(2)}
                </span>
              )}
              {targetMedian != null && targetMedian !== targetMean && (
                <span>Median ${targetMedian.toFixed(2)}</span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
