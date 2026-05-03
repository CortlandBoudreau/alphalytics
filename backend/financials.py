from fastapi import HTTPException
import yfinance as yf
import math


def safe_val(stmt, row_name, col):
    if row_name is None:
        return None
    try:
        v = stmt.loc[row_name, col]
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return None
        return int(v)
    except Exception:
        return None


def pct_change(curr, prev):
    if curr is None or prev is None or prev == 0:
        return None
    return round((curr - prev) / abs(prev) * 100, 1)


def fmt_millions(v):
    if v is None:
        return None
    return round(v / 1_000_000, 1)


def get_row(stmt, aliases):
    for alias in aliases:
        if alias in stmt.index:
            return alias
    return None


def get_quarters(stmt):
    return stmt.columns[:4]


# ── Income Statement ───────────────────────────────────────────────────────────

def build_income_quarters(ticker: str, period: str = "quarterly"):
    stock = yf.Ticker(ticker)
    info = stock.info

    if not info or ("regularMarketPrice" not in info and "currentPrice" not in info):
        raise HTTPException(status_code=404, detail="Stock not found")

    if period == "annual":
        stmt = stock.income_stmt
        if stmt is None or stmt.empty:
            raise HTTPException(status_code=404, detail="Annual income statement data not available")
    else:
        stmt = stock.quarterly_income_stmt
        if stmt is None or stmt.empty:
            stmt = stock.quarterly_financials
        if stmt is None or stmt.empty:
            raise HTTPException(status_code=404, detail="Income statement data not available")

    quarters = get_quarters(stmt)

    ROW_ALIASES = {
        "Total Revenue":     ["Total Revenue", "Revenue"],
        "Cost Of Revenue":   ["Cost Of Revenue", "Cost of Revenue", "Reconciled Cost Of Revenue"],
        "Gross Profit":      ["Gross Profit"],
        "Operating Expense": ["Operating Expense", "Total Operating Expenses", "Operating Expenses"],
        "Operating Income":  ["Operating Income", "EBIT"],
        "Net Income":        ["Net Income", "Net Income Common Stockholders"],
        "EBITDA":            ["EBITDA", "Normalized EBITDA"],
        "Basic EPS":         ["Basic EPS"],
        "Diluted EPS":       ["Diluted EPS"],
        "Tax Provision":     ["Tax Provision", "Income Tax Expense"],
        "Interest Expense":  ["Interest Expense", "Net Interest Income"],
        "Pretax Income":     ["Pretax Income", "Income Before Tax"],
        "R&D Expense":       ["Research And Development", "Research & Development"],
        "SG&A Expense":      ["Selling General And Administration", "Selling General Administrative"],
    }

    def sv(key, col):
        return safe_val(stmt, get_row(stmt, ROW_ALIASES.get(key, [key])), col)

    quarter_data = []
    for i, col in enumerate(quarters):
        if period == "annual":
            label = str(col.year) if hasattr(col, 'year') else str(col)[:4]
        else:
            label = f"Q{col.quarter} {col.year}" if hasattr(col, 'quarter') else str(col)[:7]
        prev_col = quarters[i + 1] if i + 1 < len(quarters) else None

        def pv(key):
            if prev_col is None:
                return None
            return safe_val(stmt, get_row(stmt, ROW_ALIASES.get(key, [key])), prev_col)

        revenue       = sv("Total Revenue", col)
        cost_rev      = sv("Cost Of Revenue", col)
        gross_profit  = sv("Gross Profit", col)
        op_expense    = sv("Operating Expense", col)
        op_income     = sv("Operating Income", col)
        net_income    = sv("Net Income", col)
        ebitda        = sv("EBITDA", col)
        basic_eps     = sv("Basic EPS", col)
        diluted_eps   = sv("Diluted EPS", col)
        tax           = sv("Tax Provision", col)
        interest_exp  = sv("Interest Expense", col)
        pretax_income = sv("Pretax Income", col)
        rd_expense    = sv("R&D Expense", col)
        sga_expense   = sv("SG&A Expense", col)

        gross_margin = round(gross_profit / revenue * 100, 1) if gross_profit and revenue else None
        op_margin    = round(op_income / revenue * 100, 1)    if op_income and revenue else None
        net_margin   = round(net_income / revenue * 100, 1)   if net_income and revenue else None

        quarter_data.append({
            "label": label,
            "revenue":         fmt_millions(revenue),
            "costOfRevenue":   fmt_millions(cost_rev),
            "grossProfit":     fmt_millions(gross_profit),
            "grossMargin":     gross_margin,
            "opExpense":       fmt_millions(op_expense),
            "opIncome":        fmt_millions(op_income),
            "opMargin":        op_margin,
            "netIncome":       fmt_millions(net_income),
            "netMargin":       net_margin,
            "ebitda":          fmt_millions(ebitda),
            "basicEps":        basic_eps,
            "dilutedEps":      diluted_eps,
            "taxProvision":    fmt_millions(tax),
            "interestExpense": fmt_millions(interest_exp),
            "pretaxIncome":    fmt_millions(pretax_income),
            "rdExpense":       fmt_millions(rd_expense),
            "sgaExpense":      fmt_millions(sga_expense),
            "yoy": {
                "revenue":     pct_change(revenue,      pv("Total Revenue")),
                "costOfRev":   pct_change(cost_rev,     pv("Cost Of Revenue")),
                "grossProfit": pct_change(gross_profit, pv("Gross Profit")),
                "opExpense":   pct_change(op_expense,   pv("Operating Expense")),
                "opIncome":    pct_change(op_income,    pv("Operating Income")),
                "netIncome":   pct_change(net_income,   pv("Net Income")),
                "dilutedEps":  pct_change(diluted_eps,  pv("Diluted EPS")),
                "rdExpense":   pct_change(rd_expense,   pv("R&D Expense")),
                "sgaExpense":  pct_change(sga_expense,  pv("SG&A Expense")),
            }
        })

    quarter_data = [q for q in quarter_data if q["revenue"] is not None]
    if not quarter_data:
        raise HTTPException(status_code=404, detail="No complete income statement data available")

    return quarter_data, info


# ── Balance Sheet ──────────────────────────────────────────────────────────────

def build_balance_quarters(ticker: str, period: str = "quarterly"):
    stock = yf.Ticker(ticker)
    info  = stock.info

    if not info or ("regularMarketPrice" not in info and "currentPrice" not in info):
        raise HTTPException(status_code=404, detail="Stock not found")

    if period == "annual":
        stmt = stock.balance_sheet
    else:
        stmt = stock.quarterly_balance_sheet
    if stmt is None or stmt.empty:
        raise HTTPException(status_code=404, detail="Balance sheet data not available")

    quarters = get_quarters(stmt)

    ROW_ALIASES = {
        "Total Assets":              ["Total Assets"],
        "Current Assets":            ["Current Assets"],
        "Cash":                      ["Cash And Cash Equivalents", "Cash Financial", "Cash Equivalents"],
        "Short Term Investments":    ["Other Short Term Investments", "Cash Cash Equivalents And Short Term Investments"],
        "Accounts Receivable":       ["Accounts Receivable", "Receivables"],
        "Inventory":                 ["Inventory", "Finished Goods"],
        "Net PPE":                   ["Net PPE"],
        "Total Non Current Assets":  ["Total Non Current Assets"],
        "Total Liabilities":         ["Total Liabilities Net Minority Interest"],
        "Current Liabilities":       ["Current Liabilities"],
        "Accounts Payable":          ["Accounts Payable", "Payables"],
        "Current Debt":              ["Current Debt", "Current Debt And Capital Lease Obligation"],
        "Long Term Debt":            ["Long Term Debt", "Long Term Debt And Capital Lease Obligation"],
        "Total Non Current Liabilities": ["Total Non Current Liabilities Net Minority Interest"],
        "Stockholders Equity":       ["Stockholders Equity", "Common Stock Equity"],
        "Retained Earnings":         ["Retained Earnings"],
        "Working Capital":           ["Working Capital"],
        "Net Debt":                  ["Net Debt"],
        "Total Debt":                ["Total Debt"],
    }

    def sv(key, col):
        return safe_val(stmt, get_row(stmt, ROW_ALIASES.get(key, [key])), col)

    quarter_data = []
    for i, col in enumerate(quarters):
        if period == "annual":
            label = str(col.year) if hasattr(col, 'year') else str(col)[:4]
        else:
            label = f"Q{col.quarter} {col.year}" if hasattr(col, 'quarter') else str(col)[:7]
        prev_col = quarters[i + 1] if i + 1 < len(quarters) else None

        def pv(key):
            if prev_col is None:
                return None
            return safe_val(stmt, get_row(stmt, ROW_ALIASES.get(key, [key])), prev_col)

        total_assets        = sv("Total Assets", col)
        current_assets      = sv("Current Assets", col)
        cash                = sv("Cash", col)
        st_investments      = sv("Short Term Investments", col)
        acct_receivable     = sv("Accounts Receivable", col)
        inventory           = sv("Inventory", col)
        net_ppe             = sv("Net PPE", col)
        non_current_assets  = sv("Total Non Current Assets", col)
        total_liabilities   = sv("Total Liabilities", col)
        current_liabilities = sv("Current Liabilities", col)
        acct_payable        = sv("Accounts Payable", col)
        current_debt        = sv("Current Debt", col)
        long_term_debt      = sv("Long Term Debt", col)
        non_current_liab    = sv("Total Non Current Liabilities", col)
        equity              = sv("Stockholders Equity", col)
        retained_earnings   = sv("Retained Earnings", col)
        working_capital     = sv("Working Capital", col)
        net_debt            = sv("Net Debt", col)
        total_debt          = sv("Total Debt", col)

        current_ratio  = round(current_assets / current_liabilities, 2) if current_assets and current_liabilities else None
        debt_to_equity = round(total_debt / equity, 2) if total_debt and equity and equity != 0 else None
        debt_to_assets = round(total_debt / total_assets, 2) if total_debt and total_assets else None

        quarter_data.append({
            "label": label,
            "totalAssets":           fmt_millions(total_assets),
            "currentAssets":         fmt_millions(current_assets),
            "cash":                  fmt_millions(cash),
            "shortTermInvestments":  fmt_millions(st_investments),
            "accountsReceivable":    fmt_millions(acct_receivable),
            "inventory":             fmt_millions(inventory),
            "netPPE":                fmt_millions(net_ppe),
            "nonCurrentAssets":      fmt_millions(non_current_assets),
            "totalLiabilities":      fmt_millions(total_liabilities),
            "currentLiabilities":    fmt_millions(current_liabilities),
            "accountsPayable":       fmt_millions(acct_payable),
            "currentDebt":           fmt_millions(current_debt),
            "longTermDebt":          fmt_millions(long_term_debt),
            "nonCurrentLiabilities": fmt_millions(non_current_liab),
            "stockholdersEquity":    fmt_millions(equity),
            "retainedEarnings":      fmt_millions(retained_earnings),
            "workingCapital":        fmt_millions(working_capital),
            "netDebt":               fmt_millions(net_debt),
            "totalDebt":             fmt_millions(total_debt),
            "currentRatio":          current_ratio,
            "debtToEquity":          debt_to_equity,
            "debtToAssets":          debt_to_assets,
            "yoy": {
                "totalAssets":      pct_change(total_assets,      pv("Total Assets")),
                "cash":             pct_change(cash,              pv("Cash")),
                "totalDebt":        pct_change(total_debt,        pv("Total Debt")),
                "equity":           pct_change(equity,            pv("Stockholders Equity")),
                "retainedEarnings": pct_change(retained_earnings, pv("Retained Earnings")),
            }
        })

    quarter_data = [q for q in quarter_data if q["totalAssets"] is not None]
    if not quarter_data:
        raise HTTPException(status_code=404, detail="No complete balance sheet data available")

    return quarter_data, info


# ── Cash Flow ──────────────────────────────────────────────────────────────────

def build_cashflow_quarters(ticker: str, period: str = "quarterly"):
    stock = yf.Ticker(ticker)
    info  = stock.info

    if not info or ("regularMarketPrice" not in info and "currentPrice" not in info):
        raise HTTPException(status_code=404, detail="Stock not found")

    if period == "annual":
        stmt = stock.cashflow
    else:
        stmt = stock.quarterly_cashflow
    if stmt is None or stmt.empty:
        raise HTTPException(status_code=404, detail="Cash flow data not available")

    quarters = get_quarters(stmt)

    ROW_ALIASES = {
        "Operating Cash Flow":       ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"],
        "Net Income":                ["Net Income From Continuing Operations"],
        "D&A":                       ["Depreciation And Amortization", "Depreciation Amortization Depletion"],
        "Stock Based Compensation":  ["Stock Based Compensation"],
        "Change In Working Capital": ["Change In Working Capital"],
        "Investing Cash Flow":       ["Investing Cash Flow", "Cash Flow From Continuing Investing Activities"],
        "Capex":                     ["Capital Expenditure", "Purchase Of PPE"],
        "Purchase Of Investments":   ["Purchase Of Investment"],
        "Sale Of Investments":       ["Sale Of Investment"],
        "Financing Cash Flow":       ["Financing Cash Flow", "Cash Flow From Continuing Financing Activities"],
        "Dividends Paid":            ["Cash Dividends Paid", "Common Stock Dividend Paid"],
        "Stock Buybacks":            ["Repurchase Of Capital Stock", "Common Stock Payments"],
        "Debt Issuance":             ["Long Term Debt Issuance"],
        "Debt Repayment":            ["Long Term Debt Payments"],
        "Free Cash Flow":            ["Free Cash Flow"],
        "End Cash Position":         ["End Cash Position"],
        "Changes In Cash":           ["Changes In Cash"],
    }

    def sv(key, col):
        return safe_val(stmt, get_row(stmt, ROW_ALIASES.get(key, [key])), col)

    quarter_data = []
    for i, col in enumerate(quarters):
        if period == "annual":
            label = str(col.year) if hasattr(col, 'year') else str(col)[:4]
        else:
            label = f"Q{col.quarter} {col.year}" if hasattr(col, 'quarter') else str(col)[:7]
        prev_col = quarters[i + 1] if i + 1 < len(quarters) else None

        def pv(key):
            if prev_col is None:
                return None
            return safe_val(stmt, get_row(stmt, ROW_ALIASES.get(key, [key])), prev_col)

        op_cf       = sv("Operating Cash Flow", col)
        net_income  = sv("Net Income", col)
        da          = sv("D&A", col)
        sbc         = sv("Stock Based Compensation", col)
        wc_change   = sv("Change In Working Capital", col)
        inv_cf      = sv("Investing Cash Flow", col)
        capex       = sv("Capex", col)
        buy_invest  = sv("Purchase Of Investments", col)
        sell_invest = sv("Sale Of Investments", col)
        fin_cf      = sv("Financing Cash Flow", col)
        dividends   = sv("Dividends Paid", col)
        buybacks    = sv("Stock Buybacks", col)
        debt_issue  = sv("Debt Issuance", col)
        debt_repay  = sv("Debt Repayment", col)
        fcf         = sv("Free Cash Flow", col)
        end_cash    = sv("End Cash Position", col)
        cash_change = sv("Changes In Cash", col)

        fcf_to_net_income = round(fcf / net_income, 2) if fcf and net_income and net_income != 0 else None

        quarter_data.append({
            "label": label,
            "operatingCashFlow":    fmt_millions(op_cf),
            "netIncome":            fmt_millions(net_income),
            "da":                   fmt_millions(da),
            "stockBasedComp":       fmt_millions(sbc),
            "workingCapitalChange": fmt_millions(wc_change),
            "investingCashFlow":    fmt_millions(inv_cf),
            "capex":                fmt_millions(capex),
            "purchaseInvestments":  fmt_millions(buy_invest),
            "saleInvestments":      fmt_millions(sell_invest),
            "financingCashFlow":    fmt_millions(fin_cf),
            "dividendsPaid":        fmt_millions(dividends),
            "stockBuybacks":        fmt_millions(buybacks),
            "debtIssuance":         fmt_millions(debt_issue),
            "debtRepayment":        fmt_millions(debt_repay),
            "freeCashFlow":         fmt_millions(fcf),
            "endCashPosition":      fmt_millions(end_cash),
            "changesInCash":        fmt_millions(cash_change),
            "fcfToNetIncome":       fcf_to_net_income,
            "yoy": {
                "operatingCashFlow": pct_change(op_cf,      pv("Operating Cash Flow")),
                "freeCashFlow":      pct_change(fcf,        pv("Free Cash Flow")),
                "capex":             pct_change(capex,      pv("Capex")),
                "netIncome":         pct_change(net_income, pv("Net Income")),
            }
        })

    quarter_data = [q for q in quarter_data if q["operatingCashFlow"] is not None]
    if not quarter_data:
        raise HTTPException(status_code=404, detail="No complete cash flow data available")

    return quarter_data, info
