import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts"

type EarningsQuarter = {
  quarter: string
  estimate: number | null
  actual: number | null
  surprise: number | null
}

type Props = {
  earningsHistory: EarningsQuarter[]
  nextEarningsDate: string | null
}

export function EarningsHistory({ earningsHistory, nextEarningsDate }: Props) {
  if (!earningsHistory.length && !nextEarningsDate) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Earnings History
          {nextEarningsDate && (
            <span className="text-sm font-normal text-muted-foreground">
              Next: <span className="text-foreground font-medium">{nextEarningsDate}</span>
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {earningsHistory.length > 0 ? (
          <div className="space-y-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={earningsHistory} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
                <XAxis dataKey="quarter" stroke="#888888" tick={{ fontSize: 12 }} />
                <YAxis stroke="#888888" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(2)}`} width={55} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#111111", border: "1px solid #333" }}
                  formatter={(value, name) => [`$${Number(value).toFixed(2)}`, name === "estimate" ? "Estimate" : "Actual"]}
                />
                <Legend formatter={(v) => v === "estimate" ? "Estimate" : "Actual"} />
                <Bar dataKey="estimate" fill="#3b82f6" opacity={0.5} radius={[3, 3, 0, 0]} />
                <Bar dataKey="actual" radius={[3, 3, 0, 0]}>
                  {earningsHistory.map((q, i) => (
                    <Cell
                      key={i}
                      fill={
                        q.actual == null || q.estimate == null
                          ? "#6b7280"
                          : q.actual >= q.estimate
                          ? "#10b981"
                          : "#ef4444"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Summary table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-xs">
                    <th className="text-left py-2">Quarter</th>
                    <th className="text-right py-2 px-3">Estimate</th>
                    <th className="text-right py-2 px-3">Actual</th>
                    <th className="text-right py-2 px-3">Surprise</th>
                  </tr>
                </thead>
                <tbody>
                  {[...earningsHistory].reverse().map((q) => (
                    <tr key={q.quarter} className="border-b border-border">
                      <td className="py-2 font-medium">{q.quarter}</td>
                      <td className="py-2 px-3 text-right text-muted-foreground">
                        {q.estimate != null ? `$${q.estimate.toFixed(2)}` : "—"}
                      </td>
                      <td className="py-2 px-3 text-right font-medium">
                        {q.actual != null ? `$${q.actual.toFixed(2)}` : "—"}
                      </td>
                      <td className={`py-2 px-3 text-right text-xs font-medium ${
                        q.surprise == null ? "text-muted-foreground" :
                        q.surprise >= 0 ? "text-green-500" : "text-red-500"
                      }`}>
                        {q.surprise != null
                          ? `${q.surprise >= 0 ? "+" : ""}${q.surprise.toFixed(1)}%`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No earnings history available.</p>
        )}
      </CardContent>
    </Card>
  )
}
