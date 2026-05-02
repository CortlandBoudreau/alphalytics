import React, { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

// ── Types ──────────────────────────────────────────────────────────────────────

type YoYIncome = {
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

type IncomeQuarter = {
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
  yoy: YoYIncome
}

type QuarterGrade = { label: string; grade: string; note: string }

type IncomeGrading = {
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
  quarters: IncomeQuarter[]
  grading: IncomeGrading
}

type YoYBalance = {
  totalAssets: number | null
  cash: number | null
  totalDebt: number | null
  equity: number | null
  retainedEarnings: number | null
}

type BalanceQuarter = {
  label: string
  totalAssets: number | null
  currentAssets: number | null
  cash: number | null
  shortTermInvestments: number | null
  accountsReceivable: number | null
  inventory: number | null
  netPPE: number | null
  nonCurrentAssets: number | null
  totalLiabilities: number | null
  currentLiabilities: number | null
  accountsPayable: number | null
  currentDebt: number | null
  longTermDebt: number | null
  nonCurrentLiabilities: number | null
  stockholdersEquity: number | null
  retainedEarnings: number | null
  workingCapital: number | null
  netDebt: number | null
  totalDebt: number | null
  currentRatio: number | null
  debtToEquity: number | null
  debtToAssets: number | null
  yoy: YoYBalance
}

type BalanceAnalysis = {
  summary: string
  flags: string[]
  health: string
  disclaimer: string
}

type BalanceData = {
  ticker: string
  name: string
  sector: string
  quarters: BalanceQuarter[]
  analysis: BalanceAnalysis
}

type YoYCashflow = {
  operatingCashFlow: number | null
  freeCashFlow: number | null
  capex: number | null
  netIncome: number | null
}

type CashflowQuarter = {
  label: string
  operatingCashFlow: number | null
  netIncome: number | null
  da: number | null
  stockBasedComp: number | null
  workingCapitalChange: number | null
  investingCashFlow: number | null
  capex: number | null
  purchaseInvestments: number | null
  saleInvestments: number | null
  financingCashFlow: number | null
  dividendsPaid: number | null
  stockBuybacks: number | null
  debtIssuance: number | null
  debtRepayment: number | null
  freeCashFlow: number | null
  endCashPosition: number | null
  changesInCash: number | null
  fcfToNetIncome: number | null
  yoy: YoYCashflow
}

type CashflowAnalysis = {
  summary: string
  flags: string[]
  quality: string
  disclaimer: string
}

type CashflowData = {
  ticker: string
  name: string
  sector: string
  quarters: CashflowQuarter[]
  analysis: CashflowAnalysis
}

type Props = {
  apiUrl: string
  apiToken: string
  allTickers: { ticker: string; name: string }[]
}

type StatementTab = "income" | "balance" | "cashflow"

// ── Constants ──────────────────────────────────────────────────────────────────

const GRADE_COLOR: Record<string, string> = {
  "A+": "text-blue-400", "A": "text-blue-400", "A-": "text-blue-400",
  "B+": "text-emerald-400", "B": "text-emerald-400", "B-": "text-emerald-400",
  "C+": "text-yellow-400", "C": "text-yellow-400", "C-": "text-yellow-400",
  "D": "text-orange-400", "F": "text-red-500",
}

const GRADE_BG = "bg-secondary border-border"

const SENTIMENT_COLOR = {
  bullish: "text-green-500",
  bearish: "text-red-500",
  neutral: "text-yellow-500",
}

const HEALTH_COLOR: Record<string, string> = {
  strong: "text-blue-400",
  healthy: "text-emerald-400",
  moderate: "text-yellow-400",
  weak: "text-orange-400",
  distressed: "text-red-500",
}

const QUALITY_COLOR: Record<string, string> = {
  excellent: "text-blue-400",
  good: "text-emerald-400",
  fair: "text-yellow-400",
  poor: "text-red-500",
}

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtM(v: number | null): string {
  if (v === null) return "—"
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(2)}B`
  return `$${v.toFixed(0)}M`
}

function fmtPct(v: number | null): string {
  if (v === null) return "—"
  return `${v.toFixed(1)}%`
}

function fmtRatio(v: number | null): string {
  if (v === null) return "—"
  return v.toFixed(2)
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

// ── Shared sub-components ──────────────────────────────────────────────────────

function Flags({ flags }: { flags: string[] }) {
  if (!flags.length) return null
  return (
    <div className="mt-3 space-y-1">
      {flags.map((flag, i) => (
        <div key={i} className="flex gap-2 text-xs text-orange-400">
          <span className="shrink-0">⚠</span>
          <span>{flag}</span>
        </div>
      ))}
    </div>
  )
}

function StatementTable({
  quarters,
  groups,
}: {
  quarters: { label: string }[]
  groups: { title: string; rows: { label: string; value: (q: never) => string; yoyValue?: (q: never) => number | null }[] }[]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 text-muted-foreground w-48">Metric</th>
            {quarters.map((q) => (
              <th key={q.label} className="text-right py-2 font-medium text-foreground px-3">{q.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <React.Fragment key={group.title}>
              <tr>
                <td colSpan={quarters.length + 1} className="pt-4 pb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {group.title}
                </td>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.label} className="border-b border-border hover:bg-secondary transition-colors">
                  <td className="py-2.5 text-muted-foreground pl-2 text-xs">{row.label}</td>
                  {quarters.map((q) => (
                    <td key={`${q.label}-${row.label}`} className="py-2.5 text-right px-3">
                      <div className="font-medium">{row.value(q as never)}</div>
                      {row.yoyValue && (
                        <div className="mt-0.5">
                          <YoYBadge value={row.yoyValue(q as never)} />
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
  )
}

// ── Income Tab ─────────────────────────────────────────────────────────────────

function IncomeTab({ data }: { data: IncomeData }) {
  const { grading, quarters } = data

  const groups = [
    {
      title: "Revenue",
      rows: [
        { label: "Total Revenue",   value: (q: IncomeQuarter) => fmtM(q.revenue),       yoyValue: (q: IncomeQuarter) => q.yoy.revenue },
        { label: "Cost of Revenue", value: (q: IncomeQuarter) => fmtM(q.costOfRevenue), yoyValue: (q: IncomeQuarter) => q.yoy.costOfRev },
        { label: "Gross Profit",    value: (q: IncomeQuarter) => fmtM(q.grossProfit),   yoyValue: (q: IncomeQuarter) => q.yoy.grossProfit },
        { label: "Gross Margin",    value: (q: IncomeQuarter) => fmtPct(q.grossMargin) },
      ],
    },
    {
      title: "Expenses",
      rows: [
        { label: "R&D Expense",       value: (q: IncomeQuarter) => fmtM(q.rdExpense),  yoyValue: (q: IncomeQuarter) => q.yoy.rdExpense },
        { label: "SG&A Expense",      value: (q: IncomeQuarter) => fmtM(q.sgaExpense), yoyValue: (q: IncomeQuarter) => q.yoy.sgaExpense },
        { label: "Operating Expense", value: (q: IncomeQuarter) => fmtM(q.opExpense),  yoyValue: (q: IncomeQuarter) => q.yoy.opExpense },
      ],
    },
    {
      title: "Income",
      rows: [
        { label: "Operating Income",  value: (q: IncomeQuarter) => fmtM(q.opIncome),      yoyValue: (q: IncomeQuarter) => q.yoy.opIncome },
        { label: "Operating Margin",  value: (q: IncomeQuarter) => fmtPct(q.opMargin) },
        { label: "Interest Expense",  value: (q: IncomeQuarter) => fmtM(q.interestExpense) },
        { label: "Pretax Income",     value: (q: IncomeQuarter) => fmtM(q.pretaxIncome) },
        { label: "Tax Provision",     value: (q: IncomeQuarter) => fmtM(q.taxProvision) },
        { label: "Net Income",        value: (q: IncomeQuarter) => fmtM(q.netIncome),      yoyValue: (q: IncomeQuarter) => q.yoy.netIncome },
        { label: "Net Margin",        value: (q: IncomeQuarter) => fmtPct(q.netMargin) },
      ],
    },
    {
      title: "Other",
      rows: [
        { label: "EBITDA",      value: (q: IncomeQuarter) => fmtM(q.ebitda) },
        { label: "Basic EPS",   value: (q: IncomeQuarter) => q.basicEps != null ? `$${q.basicEps.toFixed(2)}` : "—" },
        { label: "Diluted EPS", value: (q: IncomeQuarter) => q.dilutedEps != null ? `$${q.dilutedEps.toFixed(2)}` : "—", yoyValue: (q: IncomeQuarter) => q.yoy.dilutedEps },
      ],
    },
  ]

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">{grading.overall_summary}</p>
              <Flags flags={grading.flags} />
            </div>
            <div className={`flex flex-col items-center justify-center w-24 h-24 rounded-xl border-2 shrink-0 ${GRADE_BG}`}>
              <span className="text-xs text-muted-foreground mb-1">Overall</span>
              <span className={`text-4xl font-bold ${GRADE_COLOR[grading.overall_grade] ?? "text-foreground"}`}>
                {grading.overall_grade}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            {grading.quarter_grades.map((qg) => (
              <div key={qg.label} className={`rounded-lg border p-3 ${GRADE_BG}`}>
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

      <Card>
        <CardHeader>
          <CardTitle>Income Statements — Last 4 Quarters</CardTitle>
          <p className="text-xs text-muted-foreground">Values in millions (M) or billions (B). YoY = year-over-year change.</p>
        </CardHeader>
        <CardContent>
          <StatementTable quarters={quarters} groups={groups as never} />
          <p className="text-xs text-muted-foreground mt-4 border-t border-border pt-3">{grading.disclaimer}</p>
        </CardContent>
      </Card>
    </>
  )
}

// ── Balance Sheet Tab ──────────────────────────────────────────────────────────

function BalanceTab({ data }: { data: BalanceData }) {
  const { analysis, quarters } = data

  const groups = [
    {
      title: "Assets",
      rows: [
        { label: "Total Assets",          value: (q: BalanceQuarter) => fmtM(q.totalAssets),       yoyValue: (q: BalanceQuarter) => q.yoy.totalAssets },
        { label: "Current Assets",        value: (q: BalanceQuarter) => fmtM(q.currentAssets) },
        { label: "Cash & Equivalents",    value: (q: BalanceQuarter) => fmtM(q.cash),              yoyValue: (q: BalanceQuarter) => q.yoy.cash },
        { label: "Short Term Investments",value: (q: BalanceQuarter) => fmtM(q.shortTermInvestments) },
        { label: "Accounts Receivable",   value: (q: BalanceQuarter) => fmtM(q.accountsReceivable) },
        { label: "Inventory",             value: (q: BalanceQuarter) => fmtM(q.inventory) },
        { label: "Net PP&E",              value: (q: BalanceQuarter) => fmtM(q.netPPE) },
        { label: "Non-Current Assets",    value: (q: BalanceQuarter) => fmtM(q.nonCurrentAssets) },
      ],
    },
    {
      title: "Liabilities",
      rows: [
        { label: "Total Liabilities",     value: (q: BalanceQuarter) => fmtM(q.totalLiabilities) },
        { label: "Current Liabilities",   value: (q: BalanceQuarter) => fmtM(q.currentLiabilities) },
        { label: "Accounts Payable",      value: (q: BalanceQuarter) => fmtM(q.accountsPayable) },
        { label: "Current Debt",          value: (q: BalanceQuarter) => fmtM(q.currentDebt) },
        { label: "Long Term Debt",        value: (q: BalanceQuarter) => fmtM(q.longTermDebt),      yoyValue: (q: BalanceQuarter) => q.yoy.totalDebt },
        { label: "Non-Current Liabilities",value: (q: BalanceQuarter) => fmtM(q.nonCurrentLiabilities) },
      ],
    },
    {
      title: "Equity",
      rows: [
        { label: "Stockholders Equity",   value: (q: BalanceQuarter) => fmtM(q.stockholdersEquity), yoyValue: (q: BalanceQuarter) => q.yoy.equity },
        { label: "Retained Earnings",     value: (q: BalanceQuarter) => fmtM(q.retainedEarnings),   yoyValue: (q: BalanceQuarter) => q.yoy.retainedEarnings },
      ],
    },
    {
      title: "Key Metrics",
      rows: [
        { label: "Working Capital",       value: (q: BalanceQuarter) => fmtM(q.workingCapital) },
        { label: "Net Debt",              value: (q: BalanceQuarter) => fmtM(q.netDebt) },
        { label: "Total Debt",            value: (q: BalanceQuarter) => fmtM(q.totalDebt) },
        { label: "Current Ratio",         value: (q: BalanceQuarter) => fmtRatio(q.currentRatio) },
        { label: "Debt / Equity",         value: (q: BalanceQuarter) => fmtRatio(q.debtToEquity) },
        { label: "Debt / Assets",         value: (q: BalanceQuarter) => fmtRatio(q.debtToAssets) },
      ],
    },
  ]

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">{analysis.summary}</p>
              <Flags flags={analysis.flags} />
            </div>
            <div className={`flex flex-col items-center justify-center w-24 h-24 rounded-xl border-2 shrink-0 ${GRADE_BG}`}>
              <span className="text-xs text-muted-foreground mb-1">Health</span>
              <span className={`text-lg font-bold capitalize ${HEALTH_COLOR[analysis.health] ?? "text-foreground"}`}>
                {analysis.health}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Balance Sheet — Last 4 Quarters</CardTitle>
          <p className="text-xs text-muted-foreground">Values in millions (M) or billions (B). YoY = year-over-year change.</p>
        </CardHeader>
        <CardContent>
          <StatementTable quarters={quarters} groups={groups as never} />
          <p className="text-xs text-muted-foreground mt-4 border-t border-border pt-3">{analysis.disclaimer}</p>
        </CardContent>
      </Card>
    </>
  )
}

// ── Cash Flow Tab ──────────────────────────────────────────────────────────────

function CashflowTab({ data }: { data: CashflowData }) {
  const { analysis, quarters } = data

  const groups = [
    {
      title: "Operating Activities",
      rows: [
        { label: "Operating Cash Flow",    value: (q: CashflowQuarter) => fmtM(q.operatingCashFlow),    yoyValue: (q: CashflowQuarter) => q.yoy.operatingCashFlow },
        { label: "Net Income",             value: (q: CashflowQuarter) => fmtM(q.netIncome),            yoyValue: (q: CashflowQuarter) => q.yoy.netIncome },
        { label: "D&A",                    value: (q: CashflowQuarter) => fmtM(q.da) },
        { label: "Stock-Based Comp",       value: (q: CashflowQuarter) => fmtM(q.stockBasedComp) },
        { label: "Working Capital Change", value: (q: CashflowQuarter) => fmtM(q.workingCapitalChange) },
      ],
    },
    {
      title: "Investing Activities",
      rows: [
        { label: "Investing Cash Flow",    value: (q: CashflowQuarter) => fmtM(q.investingCashFlow) },
        { label: "Capex",                  value: (q: CashflowQuarter) => fmtM(q.capex),               yoyValue: (q: CashflowQuarter) => q.yoy.capex },
        { label: "Purchase Investments",   value: (q: CashflowQuarter) => fmtM(q.purchaseInvestments) },
        { label: "Sale of Investments",    value: (q: CashflowQuarter) => fmtM(q.saleInvestments) },
      ],
    },
    {
      title: "Financing Activities",
      rows: [
        { label: "Financing Cash Flow",    value: (q: CashflowQuarter) => fmtM(q.financingCashFlow) },
        { label: "Dividends Paid",         value: (q: CashflowQuarter) => fmtM(q.dividendsPaid) },
        { label: "Stock Buybacks",         value: (q: CashflowQuarter) => fmtM(q.stockBuybacks) },
        { label: "Debt Issuance",          value: (q: CashflowQuarter) => fmtM(q.debtIssuance) },
        { label: "Debt Repayment",         value: (q: CashflowQuarter) => fmtM(q.debtRepayment) },
      ],
    },
    {
      title: "Summary",
      rows: [
        { label: "Free Cash Flow",         value: (q: CashflowQuarter) => fmtM(q.freeCashFlow),         yoyValue: (q: CashflowQuarter) => q.yoy.freeCashFlow },
        { label: "FCF / Net Income",       value: (q: CashflowQuarter) => fmtRatio(q.fcfToNetIncome) },
        { label: "End Cash Position",      value: (q: CashflowQuarter) => fmtM(q.endCashPosition) },
        { label: "Net Change in Cash",     value: (q: CashflowQuarter) => fmtM(q.changesInCash) },
      ],
    },
  ]

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">{analysis.summary}</p>
              <Flags flags={analysis.flags} />
            </div>
            <div className={`flex flex-col items-center justify-center w-24 h-24 rounded-xl border-2 shrink-0 ${GRADE_BG}`}>
              <span className="text-xs text-muted-foreground mb-1">Quality</span>
              <span className={`text-lg font-bold capitalize ${QUALITY_COLOR[analysis.quality] ?? "text-foreground"}`}>
                {analysis.quality}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cash Flow — Last 4 Quarters</CardTitle>
          <p className="text-xs text-muted-foreground">Values in millions (M) or billions (B). YoY = year-over-year change.</p>
        </CardHeader>
        <CardContent>
          <StatementTable quarters={quarters} groups={groups as never} />
          <p className="text-xs text-muted-foreground mt-4 border-t border-border pt-3">{analysis.disclaimer}</p>
        </CardContent>
      </Card>
    </>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function Financials({ apiUrl, apiToken, allTickers }: Props) {
  const [ticker, setTicker] = useState("")
  const [resolvedTicker, setResolvedTicker] = useState("")
  const [resolvedName, setResolvedName] = useState("")
  const [resolvedSector, setResolvedSector] = useState("")
  const [activeTab, setActiveTab] = useState<StatementTab>("income")
  const [incomeData, setIncomeData] = useState<IncomeData | null>(null)
  const [balanceData, setBalanceData] = useState<BalanceData | null>(null)
  const [cashflowData, setCashflowData] = useState<CashflowData | null>(null)
  const [loading, setLoading] = useState(false)
  const [tabLoading, setTabLoading] = useState(false)
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
    if (upper.length < 1) { setSuggestions([]); setShowSuggestions(false); return }
    const tickerMatches = allTickers.filter(t => t.ticker.startsWith(upper)).slice(0, 6)
    const nameMatches = allTickers.filter(t => !t.ticker.startsWith(upper) && t.name.toUpperCase().startsWith(upper)).slice(0, 2)
    setSuggestions([...tickerMatches, ...nameMatches])
    setShowSuggestions(true)
  }

  const fetchIncome = async (t: string) => {
    const response = await fetch(`${apiUrl}/income/${t}`, { headers })
    const json = await response.json()
    if (!response.ok) throw new Error(json.detail || "Not found")
    return json as IncomeData
  }

  const fetchBalance = async (t: string) => {
    const response = await fetch(`${apiUrl}/balance/${t}`, { headers })
    const json = await response.json()
    if (!response.ok) throw new Error(json.detail || "Not found")
    return json as BalanceData
  }

  const fetchCashflow = async (t: string) => {
    const response = await fetch(`${apiUrl}/cashflow/${t}`, { headers })
    const json = await response.json()
    if (!response.ok) throw new Error(json.detail || "Not found")
    return json as CashflowData
  }

  const handleSearch = async (overrideTicker?: string) => {
    const t = overrideTicker || ticker
    if (!t.trim()) return
    setLoading(true)
    setError("")
    setIncomeData(null)
    setBalanceData(null)
    setCashflowData(null)
    setActiveTab("income")

    try {
      const data = await fetchIncome(t)
      setIncomeData(data)
      setResolvedTicker(data.ticker)
      setResolvedName(data.name)
      setResolvedSector(data.sector)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch")
    } finally {
      setLoading(false)
    }
  }

  const handleTabChange = async (tab: StatementTab) => {
    setActiveTab(tab)
    if (tab === "income" || !resolvedTicker) return

    if (tab === "balance" && balanceData) return
    if (tab === "cashflow" && cashflowData) return

    setTabLoading(true)
    try {
      if (tab === "balance") {
        const data = await fetchBalance(resolvedTicker)
        setBalanceData(data)
      } else if (tab === "cashflow") {
        const data = await fetchCashflow(resolvedTicker)
        setCashflowData(data)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch")
    } finally {
      setTabLoading(false)
    }
  }

  const hasData = incomeData !== null

  const TABS: { key: StatementTab; label: string }[] = [
    { key: "income",   label: "Income" },
    { key: "balance",  label: "Balance Sheet" },
    { key: "cashflow", label: "Cash Flow" },
  ]

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
                  if (e.key === "Enter") { setShowSuggestions(false); handleSearch() }
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
                      onMouseDown={() => { setTicker(s.ticker); setShowSuggestions(false); handleSearch(s.ticker) }}
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

      {hasData && (
        <>
          {/* Header */}
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">{resolvedTicker}</h2>
            <Badge variant="outline">{resolvedSector}</Badge>
            {incomeData && (
              <span className={`text-sm font-medium capitalize ${SENTIMENT_COLOR[incomeData.grading.sentiment]}`}>
                {incomeData.grading.sentiment}
              </span>
            )}
            <span className="text-muted-foreground text-sm">{resolvedName}</span>
          </div>

          {/* Statement tabs */}
          <div className="flex gap-1">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activeTab === key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tabLoading && (
            <p className="text-muted-foreground text-sm">Loading...</p>
          )}

          {!tabLoading && activeTab === "income" && incomeData && (
            <IncomeTab data={incomeData} />
          )}
          {!tabLoading && activeTab === "balance" && balanceData && (
            <BalanceTab data={balanceData} />
          )}
          {!tabLoading && activeTab === "cashflow" && cashflowData && (
            <CashflowTab data={cashflowData} />
          )}
        </>
      )}
    </div>
  )
}
