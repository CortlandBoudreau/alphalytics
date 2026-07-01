import { useState, useEffect, useMemo, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts"
import { toast } from "@/lib/toast"
import { apiFetch, apiErrorMessage } from "@/lib/api"
import { RateLimitError } from "@/components/RateLimitError"

// costBasisCurrency: the currency the costBasis number was recorded in.
// undefined = same as the stock's native currency (standard for manual entry).
// "CAD" = recorded in CAD (e.g. imported from a CAD-denominated EJ account).
// name: optional display label (used for bonds/cash that have no live quote).
// staticValue: true = skip live quote fetch (bonds, cash — value is fixed at import).
// holdingType: visual badge shown in the holdings table ("bond" | "cash" | undefined = equity).
type Holding = { id: string; ticker: string; name?: string; shares: number; costBasis: number; costBasisCurrency?: string; staticValue?: boolean; holdingType?: "bond" | "cash" | "fund" }
type QuoteMap = Record<string, { ticker: string; name: string; price: number; change: number; currency: string }>
type HistoryMap = Record<string, Record<string, number>>

const COLORS = ["#3b82f6","#f59e0b","#10b981","#ef4444","#8b5cf6","#ec4899","#06b6d4","#f97316","#a3e635","#e879f9"]

const SECTOR_COLORS: Record<string, string> = {
  // yfinance / quoteSummary names
  "Technology":             "#3b82f6",
  "Healthcare":             "#10b981",
  "Financial Services":     "#f59e0b",
  "Consumer Cyclical":      "#ec4899",
  "Consumer Defensive":     "#8b5cf6",
  "Energy":                 "#f97316",
  "Industrials":            "#06b6d4",
  "Basic Materials":        "#a3e635",
  "Real Estate":            "#e879f9",
  "Utilities":              "#64748b",
  "Communication Services": "#ef4444",
  // Wikipedia / GICS names (used by sp500:metadata)
  "Financials":             "#f59e0b",
  "Consumer Discretionary": "#ec4899",
  "Consumer Staples":       "#8b5cf6",
  "Materials":              "#a3e635",
  "Information Technology": "#3b82f6",
  "Health Care":            "#10b981",
  // Portfolio-specific
  "Fixed Income":           "#fbbf24",
  "Cash & Equivalents":     "#22c55e",
  "Mutual Funds":           "#a78bfa",
  "Other":                  "#6b7280",
}

const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const csv = [headers, ...rows].map(r => r.map(escape).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function AllocationCard({
  pieData,
  sectorData,
  colors,
  sectorColors,
}: {
  pieData: { name: string; value: number }[]
  sectorData: { name: string; value: number }[]
  colors: string[]
  sectorColors: Record<string, string>
}) {
  const [view, setView] = useState<"sector" | "holding">("sector")
  const data = view === "sector" ? sectorData : pieData
  const getColor = (name: string, i: number) =>
    view === "sector" ? (sectorColors[name] ?? "#6b7280") : colors[i % colors.length]

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Allocation</span>
          <div className="flex gap-1">
            {(["sector", "holding"] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2.5 py-0.5 rounded text-xs font-medium capitalize transition-colors ${
                  view === v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={95}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {data.map((d, i) => (
                    <Cell key={d.name} fill={getColor(d.name, i)} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#111", border: "1px solid #333" }}
                  formatter={(v, name) => [`${Number(v).toFixed(1)}%`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 mt-2">
              {data.map((d, i) => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: getColor(d.name, i) }} />
                    <span className="text-muted-foreground">{d.name}</span>
                  </div>
                  <span className="font-medium">{d.value.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-sm text-center py-8">Loading prices...</p>
        )}
      </CardContent>
    </Card>
  )
}

type Props = {
  apiUrl: string
  apiToken: string
  allTickers: { ticker: string; name: string }[]
}

export function Portfolio({ apiUrl, apiToken, allTickers }: Props) {
  const [holdings, setHoldings] = useState<Holding[]>(() => {
    try { return JSON.parse(localStorage.getItem("alphalytics_portfolio") || "[]") }
    catch { return [] }
  })
  const [quotes, setQuotes] = useState<QuoteMap>({})
  const [quotesLoading, setQuotesLoading] = useState(false)
  const [quotesError, setQuotesError] = useState<{ kind: "message"; text: string } | { kind: "rate_limit"; retryAfter: number } | null>(null)
  const [form, setForm] = useState({ ticker: "", shares: "", costBasis: "" })
  const [formError, setFormError] = useState("")
  const [suggestions, setSuggestions] = useState<{ ticker: string; name: string }[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [holdingsView, setHoldingsView] = useState<"table" | "performance">("table")
  const [historyData, setHistoryData] = useState<HistoryMap>({})
  const [historyLoading, setHistoryLoading] = useState(false)
  const [sectors, setSectors] = useState<Record<string, string>>({})

  const csvInputRef = useRef<HTMLInputElement>(null)
  const [csvPreview, setCsvPreview] = useState<{ holdings: Holding[]; filename: string } | null>(null)

  const [displayCurrency, setDisplayCurrency] = useState<"USD" | "CAD">(() =>
    (localStorage.getItem("alphalytics_currency") as "USD" | "CAD") ?? "USD"
  )

  const [digestEmail, setDigestEmail] = useState(() => localStorage.getItem("alphalytics_digest_email") ?? "")
  const [digestEnabled, setDigestEnabled] = useState(() => {
    const stored = localStorage.getItem("alphalytics_digest_enabled")
    return stored === null ? true : stored === "true"  // default ON; user must explicitly disable
  })
  const [digestSyncing, setDigestSyncing] = useState(false)
  const [digestSendingNow, setDigestSendingNow] = useState(false)

  const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` }

  useEffect(() => {
    localStorage.setItem("alphalytics_portfolio", JSON.stringify(holdings))
  }, [holdings])

  const fetchQuotes = async (hs: Holding[]) => {
    const tickers = [...new Set(hs.filter(h => !h.staticValue).map(h => h.ticker)), "USDCAD=X"]
    if (hs.length === 0) { setQuotes({}); return }
    setQuotesLoading(true)
    setQuotesError(null)
    const result = await apiFetch<QuoteMap>(
      `${apiUrl}/quotes?tickers=${encodeURIComponent(tickers.join(","))}`,
      { headers: authHeaders }
    )
    setQuotesLoading(false)
    if (!result.ok) {
      const err = result.error
      if (err.kind === "rate_limit") {
        setQuotesError({ kind: "rate_limit", retryAfter: err.retryAfter })
      } else {
        setQuotesError({ kind: "message", text: apiErrorMessage(err) })
      }
      return
    }
    const quoteMap = { ...result.data }

    // Estimate NAV for mutual fund holdings that have a holdings file on the backend
    const fundTickers = [...new Set(hs.filter(h => h.holdingType === "fund").map(h => h.ticker))]
    if (fundTickers.length > 0) {
      try {
        const navRes = await fetch(`${apiUrl}/portfolio/fund-nav`, {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ fund_codes: fundTickers }),
        })
        if (navRes.ok) {
          const navData: Record<string, number | null> = await navRes.json()
          for (const [ticker, navPerUnit] of Object.entries(navData)) {
            if (navPerUnit != null) {
              quoteMap[ticker] = {
                ticker,
                name: ticker,
                price: navPerUnit,
                change: 0,
                currency: "CAD",
              }
            }
          }
        }
      } catch {
        // fund NAV is best-effort; fall back to disclosed value
      }
    }

    setQuotes(quoteMap)
  }

  const fetchHistory = async (hs: Holding[]) => {
    const tickers = [...new Set(hs.map(h => h.ticker))]
    if (tickers.length === 0) return
    setHistoryLoading(true)
    try {
      const res = await fetch(`${apiUrl}/history?tickers=${encodeURIComponent(tickers.join(","))}`, {
        headers: authHeaders
      })
      if (res.ok) setHistoryData(await res.json())
    } catch (e) {
      console.error("Failed to fetch history", e)
    } finally {
      setHistoryLoading(false)
    }
  }

  const fetchSectors = async (hs: Holding[]) => {
    const equityTickers = [...new Set(hs.filter(h => !h.staticValue).map(h => h.ticker))]
    if (equityTickers.length === 0) return
    const url = `${apiUrl}/sectors?tickers=${encodeURIComponent(equityTickers.join(","))}`
    try {
      const res = await fetch(url, { headers: authHeaders })
      if (res.ok) {
        setSectors(await res.json())
      }
    } catch {
      // sector colours are best-effort, fail silently
    }
  }

  const syncDigest = async (email: string, hs: Holding[], enabled: boolean = digestEnabled) => {
    if (!email.includes("@") || hs.length === 0) return
    setDigestSyncing(true)
    try {
      const res = await fetch(`${apiUrl}/portfolio/sync`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          email,
          digestEnabled: enabled,
          holdings: hs.map(h => ({ ticker: h.ticker, shares: h.shares, costBasis: h.costBasis, costBasisCurrency: h.costBasisCurrency, staticValue: h.staticValue ?? false, holdingType: h.holdingType ?? null })),
        }),
      })
      const data = await res.json()
      if (data.token) localStorage.setItem("alphalytics_restore_token", data.token)
    } catch {
      toast("Failed to sync digest settings", "error")
    } finally {
      setDigestSyncing(false)
    }
  }

  useEffect(() => {
    if (digestEmail && holdings.length > 0) {
      syncDigest(digestEmail, holdings)
    }
  }, [digestEnabled, holdings])

  useEffect(() => { fetchQuotes(holdings) }, [holdings])
  useEffect(() => { fetchSectors(holdings) }, [holdings.length])

  useEffect(() => {
    if (holdingsView === "performance" && holdings.length > 0) {
      fetchHistory(holdings)
    }
  }, [holdingsView, holdings.length])

  const addHolding = () => {
    const ticker = form.ticker.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "")
    const shares = parseFloat(form.shares)
    const costBasis = parseFloat(form.costBasis)
    if (!ticker || ticker.length > 10) { setFormError("Enter a valid ticker"); return }
    if (!shares || shares <= 0)        { setFormError("Enter valid shares");    return }
    if (!costBasis || costBasis <= 0)  { setFormError("Enter valid cost basis"); return }
    setHoldings(prev => [...prev, { id: crypto.randomUUID(), ticker, shares, costBasis }])
    setForm({ ticker: "", shares: "", costBasis: "" })
    setFormError("")
    toast(`Added ${ticker} to portfolio`)
  }

  const removeHolding = (id: string) => {
    const h = holdings.find(x => x.id === id)
    setHoldings(prev => prev.filter(x => x.id !== id))
    if (h) toast(`Removed ${h.ticker} from portfolio`, "info")
  }

  const handleTickerInput = (val: string) => {
    const upper = val.toUpperCase()
    setForm(f => ({ ...f, ticker: upper }))
    if (upper.length < 1) { setSuggestions([]); setShowSuggestions(false); return }
    const tickerMatches = allTickers.filter(t => t.ticker.startsWith(upper)).slice(0, 6)
    const nameMatches = allTickers
      .filter(t => !t.ticker.startsWith(upper) && t.name.toUpperCase().startsWith(upper))
      .slice(0, 2)
    const next = [...tickerMatches, ...nameMatches]
    setSuggestions(next)
    setShowSuggestions(next.length > 0)
  }

  const selectSuggestion = (t: string) => {
    setForm(f => ({ ...f, ticker: t }))
    setSuggestions([])
    setShowSuggestions(false)
  }

  // USDCAD=X: how many CAD per 1 USD (e.g. 1.36). Used to convert between currencies.
  const usdcad = quotes["USDCAD=X"]?.price ?? 1.36

  const fmt$ = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: displayCurrency, minimumFractionDigits: 2 })

  const rows = useMemo(() => holdings.map(h => {
    const q = quotes[h.ticker]
    // For holdings with no live quote (bonds, cash), fall back to costBasisCurrency
    // so we still convert totals correctly.
    const stockCurrency = q?.currency ?? h.costBasisCurrency ?? "USD"
    const cbCurrency    = h.costBasisCurrency ?? stockCurrency

    // Step 1 — normalise costBasis into stockCurrency
    let cbInStockCurrency = h.costBasis
    if (cbCurrency === "CAD" && stockCurrency === "USD") cbInStockCurrency = h.costBasis / usdcad
    else if (cbCurrency === "USD" && stockCurrency === "CAD") cbInStockCurrency = h.costBasis * usdcad

    // Step 2 — convert to displayCurrency
    const toDisplay = (amount: number) => {
      if (displayCurrency === "CAD" && stockCurrency === "USD") return amount * usdcad
      if (displayCurrency === "USD" && stockCurrency === "CAD") return amount / usdcad
      return amount
    }

    const livePrice  = q?.price != null ? toDisplay(q.price) : null
    const costBasis  = toDisplay(cbInStockCurrency)
    // Bonds/cash have no live price — use their import value so they contribute to the total
    const effectivePrice = livePrice ?? costBasis
    const currentValue   = effectivePrice * h.shares
    const totalCost      = costBasis * h.shares
    // Only show P&L for holdings with a live price; bonds/cash show "—"
    const pnlDollar = livePrice != null ? currentValue - totalCost : null
    const pnlPct    = pnlDollar != null && totalCost > 0 ? (pnlDollar / totalCost) * 100 : null
    return { ...h, name: q?.name ?? h.name ?? h.ticker, price: livePrice, currentValue, totalCost, pnlDollar, pnlPct }
  }), [holdings, quotes, displayCurrency, usdcad])

  const totalValue = rows.reduce((s, r) => s + (r.currentValue ?? 0), 0)
  const totalCost  = rows.reduce((s, r) => s + r.totalCost, 0)
  const totalPnl   = totalValue - totalCost
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0

  const pieData = rows
    .filter(r => r.currentValue != null && r.currentValue > 0)
    .map(r => ({ name: r.ticker, value: totalValue > 0 ? (r.currentValue! / totalValue) * 100 : 0 }))

  const sectorData = useMemo(() => {
    const map: Record<string, number> = {}
    for (const row of rows) {
      const sector =
        row.holdingType === "bond"  ? "Fixed Income" :
        row.holdingType === "cash"  ? "Cash & Equivalents" :
        row.holdingType === "fund"  ? "Mutual Funds" :
        sectors[row.ticker] ?? "Other"
      map[sector] = (map[sector] ?? 0) + (row.currentValue ?? 0)
    }
    return Object.entries(map)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name, value: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
  }, [rows, sectors, totalValue])

  const summaryMetrics = [
    { label: "Total Value", value: fmt$(totalValue),       color: "" },
    { label: "Total Cost",  value: fmt$(totalCost),        color: "" },
    { label: "Total P&L",   value: fmt$(totalPnl),         color: totalPnl >= 0 ? "text-green-500" : "text-red-500" },
    { label: "Return",      value: fmtPct(totalPnlPct),    color: totalPnlPct >= 0 ? "text-green-500" : "text-red-500" },
  ]

  // Portfolio performance series vs SPY
  const perfSeries = useMemo(() => {
    if (!Object.keys(historyData).length || !holdings.length) return []

    // Get all dates present in SPY (our benchmark anchor)
    const spyPrices = historyData["SPY"] || {}
    const dates = Object.keys(spyPrices).sort()
    if (dates.length < 2) return []

    const series = dates.map(date => {
      let portValue = 0
      for (const h of holdings) {
        const price = historyData[h.ticker]?.[date]
        if (price != null) portValue += h.shares * price
      }
      return { date, portValue, spyPrice: spyPrices[date] }
    }).filter(d => d.portValue > 0)

    if (series.length < 2) return []

    const basePort = series[0].portValue
    const baseSpy  = series[0].spyPrice
    return series.map(d => ({
      date: d.date.slice(5),  // "MM-DD"
      portfolio: parseFloat(((d.portValue / basePort - 1) * 100).toFixed(2)),
      spy:       parseFloat(((d.spyPrice  / baseSpy  - 1) * 100).toFixed(2)),
    }))
  }, [historyData, holdings])

  const parseCSVRow = (line: string): string[] => {
    const result: string[] = []
    let inQuote = false
    let current = ""
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote }
      else if (ch === "," && !inQuote) { result.push(current.trim()); current = "" }
      else { current += ch }
    }
    result.push(current.trim())
    return result
  }

  const parseEdwardJonesCSV = (text: string): Holding[] => {
    const lines = text.split(/\r?\n/)
    const headerIdx = lines.findIndex(l => l.toUpperCase().includes("SYMBOL"))
    if (headerIdx === -1) throw new Error("Could not find SYMBOL column — is this an Edward Jones export?")

    const headers = parseCSVRow(lines[headerIdx]).map(h => h.replace(/"/g, "").trim().toUpperCase())
    const col = (name: string) => headers.indexOf(name)
    const symbolIdx      = col("SYMBOL")
    const quantityIdx    = col("QUANTITY")
    const priceIdx       = col("CURRENT PRICE")
    const typeIdx        = col("TYPE")
    const currencyIdx    = col("CURRENCY")
    const descIdx        = col("DESCRIPTION")
    const marketValueIdx = col("MARKET VALUE")

    if (symbolIdx === -1) throw new Error("Missing required column (SYMBOL)")

    const parseAmount = (s: string | undefined) =>
      parseFloat((s ?? "").replace(/["$, ]/g, ""))

    const results: Holding[] = []
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      const cols = parseCSVRow(line)

      const type = typeIdx !== -1 ? cols[typeIdx]?.replace(/"/g, "").trim() ?? "" : ""
      const accountCurrency = currencyIdx !== -1 ? cols[currencyIdx]?.replace(/"/g, "").trim().toUpperCase() : undefined
      const marketValue = marketValueIdx !== -1 ? parseAmount(cols[marketValueIdx]) : NaN
      const description = descIdx !== -1 ? cols[descIdx]?.replace(/"/g, "").trim() ?? "" : ""

      // ── Mutual Funds ──────────────────────────────────────────────────────
      if (/mutual[\s.]fund/i.test(type)) {
        if (!marketValue || marketValue <= 0) continue
        const symbol = cols[symbolIdx]?.replace(/"/g, "").trim().toUpperCase()
        const ticker = symbol || `FUND${results.length + 1}`
        const shortName = description.split(/\s+(CLASS|FONDS|SERIES|SR)\s+/i)[0].trim().slice(0, 32)
        const qty = parseFloat(cols[quantityIdx]?.replace(/[",]/g, "") ?? "")
        const navPrice = priceIdx !== -1 ? parseAmount(cols[priceIdx]) : NaN
        results.push({
          id: crypto.randomUUID(),
          ticker,
          name: shortName || ticker,
          shares: qty > 0 ? qty : 1,
          costBasis: navPrice > 0 ? navPrice : (qty > 0 ? marketValue / qty : marketValue),
          costBasisCurrency: accountCurrency,
          staticValue: true,
          holdingType: "fund",
        })
        continue
      }

      // ── GICs / Term Deposits ─────────────────────────────────────────────
      if (/guaranteed.investment|term.deposit/i.test(type)) {
        if (!marketValue || marketValue <= 0) continue
        const symbol = cols[symbolIdx]?.replace(/"/g, "").trim().toUpperCase()
        const ticker = symbol || `GIC${results.length + 1}`
        const shortName = description.split(/\s+DUE\s+/i)[0].trim().slice(0, 32)
        results.push({
          id: crypto.randomUUID(),
          ticker,
          name: shortName || ticker,
          shares: 1,
          costBasis: marketValue,
          costBasisCurrency: accountCurrency,
          staticValue: true,
          holdingType: "bond",
        })
        continue
      }

      // ── Bonds ────────────────────────────────────────────────────────────
      // Price is % of par, quantity is face value in dollars.
      // Use the pre-computed MARKET VALUE as the position value (shares=1).
      if (/bond/i.test(type)) {
        if (!marketValue || marketValue <= 0) continue
        const symbol = cols[symbolIdx]?.replace(/"/g, "").trim().toUpperCase()
        const ticker = symbol || `BOND${results.length + 1}`
        const shortName = description.split(/\s+(EXT|SR\s+UNSEC|MTN|DUE)\s+/i)[0].trim().slice(0, 32)
        results.push({
          id: crypto.randomUUID(),
          ticker,
          name: shortName || ticker,
          shares: 1,
          costBasis: marketValue,
          costBasisCurrency: accountCurrency,
          staticValue: true,
          holdingType: "bond",
        })
        continue
      }

      // ── Cash ─────────────────────────────────────────────────────────────
      if (/cash/i.test(type)) {
        if (!marketValue || marketValue <= 0) continue
        results.push({
          id: crypto.randomUUID(),
          ticker: "CASH",
          name: "Cash",
          shares: 1,
          costBasis: marketValue,
          costBasisCurrency: accountCurrency,
          staticValue: true,
          holdingType: "cash",
        })
        continue
      }

      // ── Skip remaining non-equity types ───────────────────────────────────
      if (/annuit|option/i.test(type)) continue

      // ── Equities & ETFs ───────────────────────────────────────────────────
      const symbol = cols[symbolIdx]?.replace(/"/g, "").trim().toUpperCase()
      if (!symbol) continue
      const quantity = parseFloat(cols[quantityIdx]?.replace(/[",]/g, "") ?? "")
      if (!quantity || quantity <= 0) continue
      const price = priceIdx !== -1 ? parseAmount(cols[priceIdx]) : NaN

      // Some brokers export equities with a CUSIP/numeric ID instead of a ticker.
      // Preserve the position as a static value so it isn't silently dropped.
      if (!/^[A-Z]{1,5}(\.[A-Z0-9]{1,2})?$/.test(symbol)) {
        const mv = marketValueIdx !== -1 ? parseAmount(cols[marketValueIdx]) : NaN
        if (!mv || mv <= 0) continue
        const shortName = description.split(/\s{2,}/)[0].trim().slice(0, 32) || symbol
        results.push({
          id: crypto.randomUUID(),
          ticker: symbol,
          name: shortName,
          shares: quantity,
          costBasis: mv / quantity,
          costBasisCurrency: accountCurrency,
          staticValue: true,
        })
        continue
      }

      results.push({
        id: crypto.randomUUID(),
        ticker: symbol,
        shares: quantity,
        costBasis: price > 0 ? price : 0,
        costBasisCurrency: accountCurrency,
      })
    }

    // Combine duplicate tickers across accounts (e.g. GOOGL in Individual + TFSA)
    const combined = new Map<string, Holding>()
    for (const h of results) {
      const existing = combined.get(h.ticker)
      if (!existing) { combined.set(h.ticker, { ...h }); continue }
      if (h.staticValue && existing.staticValue) {
        existing.costBasis += h.costBasis          // sum market values for static positions
      } else if (!h.staticValue && !existing.staticValue) {
        const total = existing.shares + h.shares
        existing.costBasis = (existing.costBasis * existing.shares + h.costBasis * h.shares) / total
        existing.shares = total
      }
    }
    return Array.from(combined.values())
  }

  const handleCSVFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = parseEdwardJonesCSV(ev.target?.result as string)
        if (parsed.length === 0) { toast("No valid holdings found in CSV", "error"); return }
        setCsvPreview({ holdings: parsed, filename: file.name })
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to parse CSV", "error")
      }
    }
    reader.readAsText(file)
  }

  const applyCSVImport = (mode: "replace" | "add") => {
    if (!csvPreview) return
    const toAdd = csvPreview.holdings
    if (mode === "replace") {
      setHoldings(toAdd)
      toast(`Imported ${toAdd.length} holdings — portfolio replaced`)
    } else {
      const existing = new Set(holdings.map(h => h.ticker))
      const newOnes = toAdd.filter(h => !existing.has(h.ticker))
      setHoldings(prev => [...prev, ...newOnes])
      const skipped = toAdd.length - newOnes.length
      toast(`Added ${newOnes.length} holding${newOnes.length !== 1 ? "s" : ""}${skipped > 0 ? ` (${skipped} already existed, skipped)` : ""}`)
    }
    setCsvPreview(null)
  }

  const exportPortfolioCSV = () => {
    const headers = ["Ticker", "Name", "Shares", "Cost Basis/Share", "Current Price", "Current Value", "Total Cost", "P&L ($)", "P&L (%)"]
    const csvRows = rows.map(r => [
      r.ticker,
      r.name,
      r.shares,
      r.costBasis.toFixed(2),
      r.price != null ? r.price.toFixed(2) : "",
      r.currentValue != null ? r.currentValue.toFixed(2) : "",
      r.totalCost.toFixed(2),
      r.pnlDollar != null ? r.pnlDollar.toFixed(2) : "",
      r.pnlPct != null ? r.pnlPct.toFixed(2) + "%" : "",
    ])
    downloadCSV("portfolio.csv", headers, csvRows)
  }

  return (
    <div className="space-y-6">
      <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCSVFile} />

      {/* Add Holding */}
      <Card className="overflow-visible">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Add Holding</span>
            <button
              onClick={() => csvInputRef.current?.click()}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Import CSV
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-visible">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Ticker with autocomplete */}
            <div className="space-y-1 flex-1 min-w-[140px] relative">
              <label className="text-xs text-muted-foreground">Ticker</label>
              <input
                type="text"
                placeholder="AAPL"
                value={form.ticker}
                onChange={e => handleTickerInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") { setShowSuggestions(false); addHolding() }
                  if (e.key === "Escape") setShowSuggestions(false)
                }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                className="w-full px-3 py-1.5 rounded-md bg-secondary border border-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary text-sm"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border rounded-md shadow-lg overflow-hidden">
                  {suggestions.map(s => (
                    <button
                      key={s.ticker}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-secondary transition-colors flex items-center justify-between"
                      onMouseDown={() => selectSuggestion(s.ticker)}
                    >
                      <span className="font-medium text-primary">{s.ticker}</span>
                      <span className="text-muted-foreground text-xs truncate ml-3">{s.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Shares */}
            <div className="space-y-1 flex-1 min-w-[100px]">
              <label className="text-xs text-muted-foreground">Shares</label>
              <input
                type="number"
                step="any"
                min="0"
                placeholder="10"
                value={form.shares}
                onChange={e => setForm(f => ({ ...f, shares: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && addHolding()}
                className="w-full px-3 py-1.5 rounded-md bg-secondary border border-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary text-sm"
              />
            </div>

            {/* Cost basis */}
            <div className="space-y-1 flex-1 min-w-[130px]">
              <label className="text-xs text-muted-foreground">Cost Basis / Share</label>
              <input
                type="number"
                step="any"
                min="0"
                placeholder="150.00"
                value={form.costBasis}
                onChange={e => setForm(f => ({ ...f, costBasis: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && addHolding()}
                className="w-full px-3 py-1.5 rounded-md bg-secondary border border-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary text-sm"
              />
            </div>

            <button
              onClick={addHolding}
              className="px-5 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Add
            </button>
          </div>
          {formError && <p className="text-destructive text-xs mt-2">{formError}</p>}
        </CardContent>
      </Card>

      {csvPreview && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm font-medium">
                  Found <span className="text-primary font-semibold">{csvPreview.holdings.length} holdings</span>{" "}
                  in <span className="text-muted-foreground">{csvPreview.filename}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Cost basis set to import price — update manually for accurate P&L
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCsvPreview(null)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => applyCSVImport("add")}
                  className="px-3 py-1.5 rounded-md bg-secondary border border-border text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Add to existing
                </button>
                <button
                  onClick={() => applyCSVImport("replace")}
                  className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Replace all
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {quotesError && quotesError.kind === "rate_limit" && (
        <RateLimitError
          retryAfter={quotesError.retryAfter}
          onRetry={() => fetchQuotes(holdings)}
          message="Quote prices rate limited."
        />
      )}
      {quotesError && quotesError.kind === "message" && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
          <span className="text-destructive text-sm mt-0.5">⚠</span>
          <div className="flex-1">
            <p className="text-sm text-destructive font-medium">{quotesError.text}</p>
            <button
              onClick={() => fetchQuotes(holdings)}
              className="text-xs text-muted-foreground hover:text-foreground mt-1 underline transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {holdings.length === 0 && (
        <Card>
          <CardContent className="pt-16 pb-16 text-center">
            <svg className="mx-auto mb-5 opacity-20" width="64" height="64" viewBox="0 0 64 64" fill="none">
              <rect x="8" y="20" width="48" height="36" rx="3" stroke="currentColor" strokeWidth="2.5" className="text-primary" />
              <path d="M22 20V16a10 10 0 0 1 20 0v4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-primary" />
              <path d="M24 36h16M32 30v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted-foreground" />
            </svg>
            <h3 className="text-base font-semibold mb-2">No holdings yet</h3>
            <p className="text-muted-foreground text-sm max-w-xs mx-auto">
              Add your first position using the form above to start tracking your portfolio's performance and P&L.
            </p>
          </CardContent>
        </Card>
      )}

      {holdings.length > 0 && (
        <>
          {/* Currency toggle + Summary */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1">
              {summaryMetrics.map(m => (
                <Card key={m.label}>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                    <p className={`text-xl font-bold mt-1 ${m.color}`}>{m.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="flex gap-1 self-start mt-1">
              {(["USD", "CAD"] as const).map(c => (
                <button
                  key={c}
                  onClick={() => { setDisplayCurrency(c); localStorage.setItem("alphalytics_currency", c) }}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    displayCurrency === c
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Holdings table + Allocation */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
            {/* Table */}
            <Card className="md:col-span-3">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>Holdings</span>
                    <div className="flex gap-1">
                      {(["table", "performance"] as const).map(v => (
                        <button
                          key={v}
                          onClick={() => setHoldingsView(v)}
                          className={`px-3 py-0.5 rounded text-xs font-medium capitalize transition-colors ${
                            holdingsView === v
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={exportPortfolioCSV}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      title="Export to CSV"
                    >
                      Export CSV
                    </button>
                    <button
                      onClick={() => fetchQuotes(holdings)}
                      disabled={quotesLoading}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      {quotesLoading ? "Refreshing..." : "Refresh prices"}
                    </button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {holdingsView === "table" && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground text-right">
                          <th className="py-2 text-left font-medium">Ticker</th>
                          <th className="py-2 font-medium">Shares</th>
                          <th className="py-2 font-medium">Price</th>
                          <th className="py-2 font-medium">Value</th>
                          <th className="py-2 font-medium">P&L</th>
                          <th className="py-2 w-6" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={row.id} className="border-b border-border hover:bg-secondary transition-colors">
                            <td className="py-2.5">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <p className="font-medium text-primary">{row.ticker}</p>
                                    {!row.holdingType && (
                                      <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-blue-500/15 text-blue-400 leading-none">STOCK</span>
                                    )}
                                    {row.holdingType === "bond" && (
                                      <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 leading-none">BOND</span>
                                    )}
                                    {row.holdingType === "cash" && (
                                      <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400 leading-none">CASH</span>
                                    )}
                                    {row.holdingType === "fund" && (
                                      <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-violet-500/15 text-violet-400 leading-none">FUND</span>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground truncate max-w-[100px]">{row.name}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 text-right">{row.shares}</td>
                            <td className="py-2.5 text-right">
                              {row.price != null ? fmt$(row.price) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="py-2.5 text-right">
                              {row.currentValue != null ? fmt$(row.currentValue) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="py-2.5 text-right">
                              {row.pnlDollar != null ? (
                                <div className={row.pnlDollar >= 0 ? "text-green-500" : "text-red-500"}>
                                  <p>{fmt$(row.pnlDollar)}</p>
                                  <p className="text-xs">{fmtPct(row.pnlPct!)}</p>
                                </div>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="py-2.5 text-right">
                              <button
                                onClick={() => removeHolding(row.id)}
                                className="text-muted-foreground hover:text-destructive transition-colors text-xs"
                                title="Remove"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {holdingsView === "performance" && (
                  <div>
                    {historyLoading && (
                      <p className="text-muted-foreground text-sm text-center py-8">Loading performance data...</p>
                    )}
                    {!historyLoading && perfSeries.length > 1 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5"><span className="inline-block w-6 h-0.5 bg-blue-500" />Portfolio</span>
                          <span className="flex items-center gap-1.5"><span className="inline-block w-6 h-0.5 bg-amber-400" />SPY</span>
                        </div>
                        <ResponsiveContainer width="100%" height={220}>
                          <LineChart data={perfSeries} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
                            <XAxis dataKey="date" stroke="#888888" tick={{ fontSize: 10 }} interval={Math.floor(perfSeries.length / 6)} />
                            <YAxis stroke="#888888" tick={{ fontSize: 11 }} tickFormatter={v => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`} width={52} />
                            <Tooltip
                              contentStyle={{ backgroundColor: "#111111", border: "1px solid #333" }}
                              formatter={(value, name) => [
                                `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)}%`,
                                name === "portfolio" ? "Portfolio" : "SPY"
                              ]}
                            />
                            <Line type="monotone" dataKey="portfolio" stroke="#3b82f6" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="spy" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                          </LineChart>
                        </ResponsiveContainer>
                        <p className="text-xs text-muted-foreground text-center">% return over past 12 months (marks-to-market current holdings)</p>
                      </div>
                    )}
                    {!historyLoading && perfSeries.length <= 1 && (
                      <p className="text-muted-foreground text-sm text-center py-8">Not enough data to show performance chart.</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Allocation donut */}
            <AllocationCard
              pieData={pieData}
              sectorData={sectorData}
              colors={COLORS}
              sectorColors={SECTOR_COLORS}
            />
          </div>
        </>
      )}
      {/* Daily Email Digest */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Daily Email Digest</span>
            <button
              onClick={() => {
                const next = !digestEnabled
                setDigestEnabled(next)
                localStorage.setItem("alphalytics_digest_enabled", String(next))
                if (digestEmail) syncDigest(digestEmail, holdings, next)
              }}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${digestEnabled ? "bg-primary" : "bg-muted"}`}
              title={digestEnabled ? "Disable digest" : "Enable digest"}
            >
              <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${digestEnabled ? "translate-x-4" : "translate-x-0"}`} />
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1 flex-1 min-w-[220px]">
              <label className="text-xs text-muted-foreground">Email address</label>
              <input
                type="email"
                placeholder="you@example.com"
                value={digestEmail}
                onChange={e => {
                  setDigestEmail(e.target.value)
                  localStorage.setItem("alphalytics_digest_email", e.target.value)
                }}
                className="w-full px-3 py-1.5 rounded-md bg-secondary border border-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary text-sm"
              />
            </div>
            <button
              onClick={() => {
                if (!digestEmail.includes("@")) { toast("Enter a valid email address", "error"); return }
                if (holdings.length === 0) { toast("Add holdings first", "error"); return }
                syncDigest(digestEmail, holdings).then(() => toast("Digest settings saved"))
              }}
              disabled={digestSyncing}
              className="px-4 py-1.5 rounded-md bg-secondary border border-border text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {digestSyncing ? "Saving..." : "Save"}
            </button>
            {digestEnabled && (
              <button
                onClick={async () => {
                  if (!digestEmail.includes("@")) { toast("Save your email first", "error"); return }
                  setDigestSendingNow(true)
                  try {
                    const res = await fetch(`${apiUrl}/portfolio/send-digest`, { method: "POST", headers: authHeaders })
                    if (res.ok) toast("Digest email sent!")
                    else toast("Failed to send digest", "error")
                  } catch {
                    toast("Failed to send digest", "error")
                  } finally {
                    setDigestSendingNow(false)
                  }
                }}
                disabled={digestSendingNow}
                className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {digestSendingNow ? "Sending..." : "Send now"}
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {digestEnabled
              ? "Enabled — email sent after market close Mon–Fri. Adjust timing via DIGEST_CRON in Railway."
              : "Toggle on to receive a daily portfolio summary after market close."}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
