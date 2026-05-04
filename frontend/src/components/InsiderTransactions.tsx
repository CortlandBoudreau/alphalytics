import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type InsiderTxn = {
  date: string
  insider: string
  position: string
  transaction: string
  shares: number
  value: number
}

type Props = { insiderTransactions: InsiderTxn[] }

const fmt$ = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
    ? `$${(n / 1_000).toFixed(0)}K`
    : `$${n.toLocaleString()}`

function txnColor(txn: string) {
  const t = txn.toLowerCase()
  if (t.includes("purchase") || t.includes("buy")) return "text-green-500"
  if (t.includes("sale") || t.includes("sell")) return "text-red-500"
  return "text-muted-foreground"
}

export function InsiderTransactions({ insiderTransactions }: Props) {
  if (!insiderTransactions.length) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Insider Transactions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="text-left py-2">Date</th>
                <th className="text-left py-2 px-3">Insider</th>
                <th className="text-left py-2 px-3 hidden md:table-cell">Position</th>
                <th className="text-right py-2 px-3">Type</th>
                <th className="text-right py-2 px-3">Shares</th>
                <th className="text-right py-2">Value</th>
              </tr>
            </thead>
            <tbody>
              {insiderTransactions.map((txn, i) => (
                <tr key={i} className="border-b border-border hover:bg-secondary transition-colors">
                  <td className="py-2 text-muted-foreground whitespace-nowrap">{txn.date}</td>
                  <td className="py-2 px-3 font-medium max-w-[120px] truncate">{txn.insider}</td>
                  <td className="py-2 px-3 text-muted-foreground text-xs hidden md:table-cell max-w-[140px] truncate">{txn.position}</td>
                  <td className={`py-2 px-3 text-right text-xs font-medium whitespace-nowrap ${txnColor(txn.transaction)}`}>
                    {txn.transaction}
                  </td>
                  <td className="py-2 px-3 text-right text-muted-foreground">
                    {txn.shares > 0 ? txn.shares.toLocaleString() : "—"}
                  </td>
                  <td className="py-2 text-right font-medium">
                    {txn.value > 0 ? fmt$(txn.value) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
