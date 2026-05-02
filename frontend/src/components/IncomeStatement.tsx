import React, { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

type YoY = {
  revenue: number | null
  costOfRev: number | null
  grossProfit: number | null
  opExpense: number | null
  opIncome: number | null
  netIncome: number | null
  dilutedEps: number | null
  rdExpense: number | null
  sgaExpense: number | null
}

type Quarter = {
  label: string
  revenue: number | null
  costOfRevenue: number | null
  grossProfit: number | null
  grossMargin: number | null
  opExpense: number | null
  opIncome: number | null
  opMargin: number | null
  netIncome: number | null
  netMargin: number | null
  ebitda: number | null
  basicEps: number | null
  dilutedEps: number | null
  taxProvision: number | null
  interestExpense: number | null
  pretaxIncome: number | null
  rdExpense: number | null
  sgaExpense: number | null
  yoy: YoY
}

type QuarterGrade = {
  label: string
  grade: string
  note: string
}

type Grading = {
  overall_grade: string
  overall_summary: string
  quarter_grades: QuarterGrade[]
  flags: string[]
  sentiment: "bullish" | "bearish" | "neutral"
  disclaimer: string
}

type IncomeData = {
  ticker: string
  name: string
  sector: string
  quarters: Quarter[]
  grading: Grading
}

type Props = {
  apiUrl: string
  apiToken: string
  allTickers: { ticker: string; name: string }[]
}

const GRADE_COLOR: Record<string, string> = {
  "A+": "text-blue-400",
  "A":  "text-blue-400",
  "A-": "text-blue-400",
  "B+": "text-emerald-400",
  "B":  "text-emerald-400",
  "B-": "text-emerald-400",
  "C+": "text-yellow-400",
  "C":  "text-yellow-400",
  "C-": "text-yellow-400",
  "D":  "text-orange-400",
  "F":  "text-red-500",
}

const GRADE_BG: Record<string, string> = {
  "A+": "bg-secondary border-border",
  "A":  "bg-secondary border-border",
  "A-": "bg-secondary border-border",
  "B+": "bg-secondary border-border",
  "B":  "bg-secondary border-border",
  "B-": "bg-secondary border-border",
  "C+": "bg-secondary border-border",
  "C":  "bg-secondary border-border",
  "C-": "bg-secondary border-border",
  "D":  "bg-secondary border-border",
  "F":  "bg-secondary border-border",
}

const SENTIMENT_COLOR = {
  bullish: "text-green-500",
  bearish: "text-red-500",
  neutral: "text-yellow-500",
}

function fmtM(v: number | null): string {
  if (v === null) return "—"
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(2)}B`
  return `$${v.toFixed(0)}M`
}

function fmtPct(v: number | null): string {
  if (v === null) return "—"
  return `${v.toFixed(1)}%`
}

function YoYBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground text-xs">—</span>
  const positive = value >= 0
  return (
    <span className={`text-xs font-medium ${positive ? "text-green-500" : "text-red-500"}`}>
      {positive ? "▲" : "▼"} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

type Row = {
  label: string
  key: keyof Quarter
  yoyKey?: keyof YoY
  isMargin?: boolean
  isEps?: boolean
}

const ROWS: Row[] = [
  { label: "Total Revenue",      key: "revenue",        yoyKey: "revenue" },
  { label: "Cost of Revenue",    key: "costOfRevenue",  yoyKey: "costOfRev" },
  { label: "Gross Profit",       key: "grossProfit",    yoyKey: "grossProfit" },
  { label: "Gross Margin",       key: "grossMargin",    isMargin: true },
  { label: "R&D Expense",        key: "rdExpense",      yoyKey: "rdExpense" },
  { label: "SG&A Expense",       key: "sgaExpense",     yoyKey: "sgaExpense" },
  { label: "Operating Expense",  key: "opExpense",      yoyKey: "opExpense" },
  { label: "Operating Income",   key: "opIncome",       yoyKey: "opIncome" },
  { label: "Operating Margin",   key: "opMargin",       isMargin: true },
  { label: "Interest Expense",   key: "interestExpense" },
  { label: "Pretax Income",      key: "pretaxIncome" },
  { label: "Tax Provision",      key: "taxProvision" },
  { label: "Net Income",         key: "netIncome",      yoyKey: "netIncome" },
  { label: "Net Margin",         key: "netMargin",      isMargin: true },
  { label: "EBITDA",             key: "ebitda" },
  { label: "Basic EPS",          key: "basicEps",       isEps: true },
  { label: "Diluted EPS",        key: "dilutedEps",     yoyKey: "dilutedEps", isEps: true },
]

const ROW_GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Revenue",
    rows: ROWS.filter(r => ["revenue", "costOfRevenue", "grossProfit", "grossMargin"].includes(r.key as string))
  },
  {
    title: "Expenses",
    rows: ROWS.filter(r => ["rdExpense", "sgaExpense", "opExpense"].includes(r.key as string))
  },
  {
    title: "Income",
    rows: ROWS.filter(r => ["opIncome", "opMargin", "interestExpense", "pretaxIncome", "taxProvision", "netIncome", "netMargin"].includes(r.key as string))
  },
  {
    title: "Other",
    rows: ROWS.filter(r => ["ebitda", "basicEps", "dilutedEps"].includes(r.key as string))
  },
]

function getCellValue(q: Quarter, row: Row): string {
  const v = q[row.key]
  if (row.isMargin) return fmtPct(v as number | null)
  if (row.isEps) return v !== null ? `$${(v as number).toFixed(2)}` : "—"
  return fmtM(v as number | null)
}

export function IncomeStatement({ apiUrl, apiToken, allTickers }: Props) {
  const [ticker, setTicker] = useState("")
  const [data, setData] = useState<IncomeData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [suggestions, setSuggestions] = useState<{ ticker: string; name: string }[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiToken}`
  }

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

  const fetchIncome = async (overrideTicker?: string) => {
    const t = overrideTicker || ticker
    if (!t.trim()) return
    setLoading(true)
    setError("")
    setData(null)

    try {
      const response = await fetch(`${apiUrl}/income/${t}`, { headers })
      const json = await response.json()
      if (!response.ok) {
        setError(json.detail || "Not found")
        return
      }
      setData(json)
    } catch {
      setError("Failed to fetch")
    } finally {
      setLoading(false)
    }
  }

  const grading = data?.grading
  const quarters = data?.quarters ?? []

  return (
    <div className="space-y-6">
      {/* Search */}
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
                    fetchIncome()
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
                        fetchIncome(s.ticker)
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
              onClick={() => fetchIncome()}
              disabled={loading || !ticker.trim()}
              className="px-6 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? "Loading..." : "Search"}
            </button>
          </div>
          {error && <p className="text-destructive text-sm mt-2">{error}</p>}
        </CardContent>
      </Card>

      {data && grading && (
        <>
          {/* Overall Grade Card */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-2xl font-bold">{data.ticker}</h2>
                    <Badge variant="outline">{data.sector}</Badge>
                    <span className={`text-sm font-medium capitalize ${SENTIMENT_COLOR[grading.sentiment]}`}>
                      {grading.sentiment}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-sm mb-3">{data.name}</p>
                  <p className="text-sm text-muted-foreground">{grading.overall_summary}</p>
                  {grading.flags.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {grading.flags.map((flag, i) => (
                        <div key={i} className="flex gap-2 text-xs text-orange-400">
                          <span className="shrink-0">⚠</span>
                          <span>{flag}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Overall grade */}
                <div className={`flex flex-col items-center justify-center w-24 h-24 rounded-xl border-2 shrink-0 ${GRADE_BG[grading.overall_grade] ?? "bg-secondary border-border"}`}>
                  <span className="text-xs text-muted-foreground mb-1">Overall</span>
                  <span className={`text-4xl font-bold ${GRADE_COLOR[grading.overall_grade] ?? "text-foreground"}`}>
                    {grading.overall_grade}
                  </span>
                </div>
              </div>

              {/* Per-quarter grades */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
                {grading.quarter_grades.map((qg) => (
                  <div key={qg.label} className={`rounded-lg border p-3 ${GRADE_BG[qg.grade] ?? "bg-secondary border-border"}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">{qg.label}</span>
                      <span className={`text-xl font-bold ${GRADE_COLOR[qg.grade] ?? "text-foreground"}`}>{qg.grade}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug">{qg.note}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Income Statement Table */}
          <Card>
            <CardHeader>
              <CardTitle>Income Statements — Last 4 Quarters</CardTitle>
              <p className="text-xs text-muted-foreground">Values in millions (M) or billions (B). YoY = year-over-year change.</p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 text-muted-foreground w-40">Metric</th>
                      {quarters.map((q) => (
                        <th key={q.label} className="text-right py-2 font-medium text-foreground px-3">
                          {q.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ROW_GROUPS.map((group) => (
                      <React.Fragment key={group.title}>
                        <tr>
                          <td
                            colSpan={quarters.length + 1}
                            className="pt-4 pb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground"
                          >
                            {group.title}
                          </td>
                        </tr>
                        {group.rows.map((row) => (
                          <tr key={row.label} className="border-b border-border hover:bg-secondary transition-colors">
                            <td className="py-2.5 text-muted-foreground pl-2 text-xs">{row.label}</td>
                            {quarters.map((q) => (
                              <td key={`${q.label}-${row.label}`} className="py-2.5 text-right px-3">
                                <div className="font-medium">{getCellValue(q, row)}</div>
                                {row.yoyKey && (
                                  <div className="mt-0.5">
                                    <YoYBadge value={q.yoy[row.yoyKey]} />
                                  </div>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-4 border-t border-border pt-3">{grading.disclaimer}</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}