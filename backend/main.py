from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from pathlib import Path
import anthropic
import yfinance as yf
import redis
import requests
import os
import json
import math

env = os.getenv("ENV", "development")
env_file = Path(__file__).parent / f".env.{env}"
if env_file.exists():
    load_dotenv(dotenv_path=env_file, override=True)

security = HTTPBearer()

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = os.getenv("API_SECRET_TOKEN")
    if credentials.credentials != token:
        raise HTTPException(status_code=403, detail="Unauthorized")

app = FastAPI()

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

allowed_origins = ["http://localhost:5173", "http://localhost:5174"]
frontend_url = os.getenv("FRONTEND_URL")
if frontend_url:
    allowed_origins.append(frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
r = redis.from_url(redis_url, decode_responses=True)

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

def load_tickers_into_redis():
    try:
        print("Loading tickers from SEC EDGAR...")
        response = requests.get(
            "https://www.sec.gov/files/company_tickers.json",
            headers={"User-Agent": "Alphalytics contact@alphalytics.com"}
        )
        data = response.json()
        tickers = []
        for item in data.values():
            tickers.append({
                "ticker": item["ticker"].upper(),
                "name": item["title"]
            })
        r.setex("tickers", 86400, json.dumps(tickers))
        print(f"Loaded {len(tickers)} tickers into Redis")
        return tickers
    except Exception as e:
        print(f"Error loading tickers: {str(e)}")
        return []

@app.on_event("startup")
async def startup_event():
    if not r.exists("tickers"):
        load_tickers_into_redis()
    else:
        print("Tickers already cached in Redis")

@app.get("/")
def read_root():
    return {"status": "Alphalytics API is running"}

@app.get("/tickers")
@limiter.limit("10/minute")
async def get_tickers(request: Request, _: None = Depends(verify_token)):
    try:
        cached = r.get("tickers")
        if cached:
            return json.loads(cached)
        tickers = load_tickers_into_redis()
        return tickers
    except Exception as e:
        print(f"ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/stock/{ticker}")
@limiter.limit("10/minute")
async def get_stock(request: Request, ticker: str, _: None = Depends(verify_token)):
    ticker = "".join(c for c in ticker.upper() if c.isalnum() or c == "-")
    if not ticker or len(ticker) > 10:
        raise HTTPException(status_code=400, detail="Invalid ticker")

    cache_key = f"stock:{ticker}"
    cached = r.get(cache_key)
    if cached:
        print(f"Cache hit for {ticker}")
        return json.loads(cached)

    try:
        stock = yf.Ticker(ticker)
        info = stock.info

        if not info or "regularMarketPrice" not in info and "currentPrice" not in info:
            raise HTTPException(status_code=404, detail="Stock not found")

        hist = stock.history(period="1y", interval="1mo")
        chart_data = []
        for date, row in hist.iterrows():
            chart_data.append({
                "date": date.strftime("%b %Y"),
                "price": round(row["Close"], 2),
                "volume": int(row["Volume"])
            })

        financials = stock.quarterly_financials
        revenue_data = []
        if not financials.empty and "Total Revenue" in financials.index:
            revenue = financials.loc["Total Revenue"]
            for date, value in revenue.items():
                if value and not isinstance(value, float) or value == value:
                    revenue_data.append({
                        "quarter": f"Q{date.quarter} {date.year}" if hasattr(date, 'quarter') else str(date)[:7],
                        "revenue": int(value) if value else 0
                    })
            revenue_data.reverse()

        price = info.get("currentPrice") or info.get("regularMarketPrice") or 0
        market_cap = info.get("marketCap", 0)

        def format_large_number(n):
            if not n:
                return "N/A"
            if n >= 1_000_000_000_000:
                return f"${n/1_000_000_000_000:.2f}T"
            if n >= 1_000_000_000:
                return f"${n/1_000_000_000:.2f}B"
            if n >= 1_000_000:
                return f"${n/1_000_000:.2f}M"
            return f"${n:,.0f}"

        def format_percent(v):
            if v is None:
                return None
            return round(v * 100, 2)

        def format_ratio(v):
            if v is None:
                return None
            return round(v, 2)

        result = {
            "ticker": ticker,
            "name": info.get("longName", ticker),
            "price": price,
            "change": info.get("regularMarketChangePercent", 0),
            "marketCap": format_large_number(market_cap),
            "peRatio": round(info.get("trailingPE", 0), 2) if info.get("trailingPE") else None,
            "forwardPE": format_ratio(info.get("forwardPE")),
            "weekHigh52": info.get("fiftyTwoWeekHigh", 0),
            "weekLow52": info.get("fiftyTwoWeekLow", 0),
            "volume": format_large_number(info.get("regularMarketVolume", 0)),
            "description": info.get("longBusinessSummary", "")[:500],
            "sector": info.get("sector", "N/A"),
            "industry": info.get("industry", "N/A"),
            "ttmEpsGrowth": format_percent(info.get("earningsGrowth")),
            "ttmRevenueGrowth": format_percent(info.get("revenueGrowth")),
            "grossMargin": format_percent(info.get("grossMargins")),
            "netMargin": format_percent(info.get("profitMargins")),
            "ttmPsRatio": format_ratio(info.get("priceToSalesTrailing12Months")),
            "chartData": chart_data,
            "revenueData": revenue_data,
        }

        r.setex(cache_key, 900, json.dumps(result))
        return result

    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/income/{ticker}")
@limiter.limit("5/minute")
async def get_income(request: Request, ticker: str, _: None = Depends(verify_token)):
    ticker = "".join(c for c in ticker.upper() if c.isalnum() or c == "-")
    if not ticker or len(ticker) > 10:
        raise HTTPException(status_code=400, detail="Invalid ticker")

    cache_key = f"income:{ticker}"
    cached = r.get(cache_key)
    if cached:
        print(f"Cache hit for income {ticker}")
        return json.loads(cached)

    try:
        stock = yf.Ticker(ticker)
        info = stock.info

        if not info or ("regularMarketPrice" not in info and "currentPrice" not in info):
            raise HTTPException(status_code=404, detail="Stock not found")

        # Try quarterly_income_stmt first, fall back to quarterly_financials
        stmt = stock.quarterly_income_stmt
        if stmt is None or stmt.empty:
            stmt = stock.quarterly_financials
        if stmt is None or stmt.empty:
            raise HTTPException(status_code=404, detail="Income statement data not available for this ticker")

        # Take last 4 quarters, most recent first
        quarters = stmt.columns[:4]

        # Row mapping — yfinance uses different names across versions
        ROW_ALIASES = {
            "Total Revenue":        ["Total Revenue", "Revenue"],
            "Cost Of Revenue":      ["Cost Of Revenue", "Cost of Revenue", "Reconciled Cost Of Revenue"],
            "Gross Profit":         ["Gross Profit"],
            "Operating Expense":    ["Operating Expense", "Total Operating Expenses", "Operating Expenses"],
            "Operating Income":     ["Operating Income", "EBIT"],
            "Net Income":           ["Net Income", "Net Income Common Stockholders"],
            "EBITDA":               ["EBITDA", "Normalized EBITDA"],
            "Basic EPS":            ["Basic EPS"],
            "Diluted EPS":          ["Diluted EPS"],
            "Tax Provision":        ["Tax Provision", "Income Tax Expense"],
            "Interest Expense":     ["Interest Expense", "Net Interest Income"],
            "Pretax Income":        ["Pretax Income", "Income Before Tax"],
            "R&D Expense":          ["Research And Development", "Research & Development"],
            "SG&A Expense":         ["Selling General And Administration", "Selling General Administrative"],
        }

        def get_row(label):
            for alias in ROW_ALIASES.get(label, [label]):
                if alias in stmt.index:
                    return alias
            return None

        def safe_val(row_name, col):
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

        # Build quarter data
        quarter_data = []
        for i, col in enumerate(quarters):
            label = f"Q{col.quarter} {col.year}" if hasattr(col, 'quarter') else str(col)[:7]
            prev_col = quarters[i + 1] if i + 1 < len(quarters) else None

            def val(key):
                return safe_val(get_row(key), col)

            def prev_val(key):
                if prev_col is None:
                    return None
                return safe_val(get_row(key), prev_col)

            revenue       = val("Total Revenue")
            cost_rev      = val("Cost Of Revenue")
            gross_profit  = val("Gross Profit")
            op_expense    = val("Operating Expense")
            op_income     = val("Operating Income")
            net_income    = val("Net Income")
            ebitda        = val("EBITDA")
            basic_eps     = val("Basic EPS")
            diluted_eps   = val("Diluted EPS")
            tax           = val("Tax Provision")
            interest_exp  = val("Interest Expense")
            pretax_income = val("Pretax Income")
            rd_expense    = val("R&D Expense")
            sga_expense   = val("SG&A Expense")

            p_revenue      = prev_val("Total Revenue")
            p_cost_rev     = prev_val("Cost Of Revenue")
            p_gross_profit = prev_val("Gross Profit")
            p_op_expense   = prev_val("Operating Expense")
            p_op_income    = prev_val("Operating Income")
            p_net_income   = prev_val("Net Income")
            p_diluted_eps  = prev_val("Diluted EPS")
            p_rd           = prev_val("R&D Expense")
            p_sga          = prev_val("SG&A Expense")

            # Compute margins
            gross_margin  = round(gross_profit / revenue * 100, 1) if gross_profit and revenue else None
            op_margin     = round(op_income / revenue * 100, 1)    if op_income and revenue else None
            net_margin    = round(net_income / revenue * 100, 1)   if net_income and revenue else None

            quarter_data.append({
                "label": label,
                "revenue":        fmt_millions(revenue),
                "costOfRevenue":  fmt_millions(cost_rev),
                "grossProfit":    fmt_millions(gross_profit),
                "grossMargin":    gross_margin,
                "opExpense":      fmt_millions(op_expense),
                "opIncome":       fmt_millions(op_income),
                "opMargin":       op_margin,
                "netIncome":      fmt_millions(net_income),
                "netMargin":      net_margin,
                "ebitda":         fmt_millions(ebitda),
                "basicEps":       basic_eps,
                "dilutedEps":     diluted_eps,
                "taxProvision":   fmt_millions(tax),
                "interestExpense":fmt_millions(interest_exp),
                "pretaxIncome":   fmt_millions(pretax_income),
                "rdExpense":      fmt_millions(rd_expense),
                "sgaExpense":     fmt_millions(sga_expense),
                # YoY growth rates
                "yoy": {
                    "revenue":     pct_change(revenue, p_revenue),
                    "costOfRev":   pct_change(cost_rev, p_cost_rev),
                    "grossProfit": pct_change(gross_profit, p_gross_profit),
                    "opExpense":   pct_change(op_expense, p_op_expense),
                    "opIncome":    pct_change(op_income, p_op_income),
                    "netIncome":   pct_change(net_income, p_net_income),
                    "dilutedEps":  pct_change(diluted_eps, p_diluted_eps),
                    "rdExpense":   pct_change(rd_expense, p_rd),
                    "sgaExpense":  pct_change(sga_expense, p_sga),
                }
            })

        # Drop incomplete quarters (current in-progress quarter has null revenue)
        quarter_data = [q for q in quarter_data if q["revenue"] is not None]

        if not quarter_data:
            raise HTTPException(status_code=404, detail="No complete income statement data available")

        # Build AI grading prompt
        sector = info.get("sector", "Unknown")
        name   = info.get("longName", ticker)

        quarters_summary = []
        for q in quarter_data:
            yoy = q["yoy"]
            quarters_summary.append(f"""
{q['label']}:
  Revenue: ${q['revenue']}M (YoY: {yoy['revenue']}%)
  Cost of Revenue: ${q['costOfRevenue']}M (YoY: {yoy['costOfRev']}%)
  Gross Profit: ${q['grossProfit']}M | Gross Margin: {q['grossMargin']}%
  Operating Income: ${q['opIncome']}M (YoY: {yoy['opIncome']}%) | Op Margin: {q['opMargin']}%
  Net Income: ${q['netIncome']}M (YoY: {yoy['netIncome']}%) | Net Margin: {q['netMargin']}%
  Diluted EPS: {q['dilutedEps']} (YoY: {yoy['dilutedEps']}%)
  R&D: ${q['rdExpense']}M (YoY: {yoy['rdExpense']}%)
  SG&A: ${q['sgaExpense']}M (YoY: {yoy['sgaExpense']}%)
  EBITDA: ${q['ebitda']}M
  Tax Provision: ${q['taxProvision']}M
""")

        prompt = f"""You are a financial analyst grading quarterly income statements for {name} ({ticker}), sector: {sector}.

Grade each quarter AND provide an overall grade using this scale: A+, A, A-, B+, B, B-, C+, C, C-, D, F

Grading criteria (apply contextually based on sector):
- Revenue growth rate and acceleration/deceleration
- Whether expense growth is faster or slower than revenue growth (key signal)
- Operating income and net income growth
- Margin trends (expanding = good, contracting = bad)
- One-time or unusual items (tax spikes, large interest changes) — flag and penalize slightly
- EPS growth
- Overall financial health and discipline

For context: tech companies should grow faster than restaurants/retail. Grade relative to sector norms.

Here are the last 4 quarters of income statement data:
{''.join(quarters_summary)}

Return ONLY this JSON, no markdown, no backticks:
{{
  "overall_grade": "A",
  "overall_summary": "2-3 sentence summary of financial health and trends",
  "quarter_grades": [
    {{
      "label": "{quarter_data[0]['label'] if quarter_data else ''}",
      "grade": "A",
      "note": "one sentence on what drove this grade"
    }}
  ],
  "flags": ["any one-time items or risks worth noting"],
  "sentiment": "bullish" | "bearish" | "neutral",
  "disclaimer": "This is not financial advice. Always do your own research."
}}
"""

        message = client.messages.create(
            model=os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5"),
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}]
        )

        raw = message.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]
        if raw.endswith("```"):
            raw = raw.rsplit("```", 1)[0]
        raw = raw.strip()

        grading = json.loads(raw)

        result = {
            "ticker": ticker,
            "name": name,
            "sector": sector,
            "quarters": quarter_data,
            "grading": grading,
        }

        # Cache for 1 hour
        r.setex(cache_key, 3600, json.dumps(result))
        return result

    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


class AnalysisRequest(BaseModel):
    ticker: str
    name: str
    price: float
    change: float
    marketCap: str
    peRatio: str | float | None
    forwardPE: float | None
    weekHigh52: float
    weekLow52: float
    sector: str
    description: str
    ttmEpsGrowth: float | None
    ttmRevenueGrowth: float | None
    grossMargin: float | None
    netMargin: float | None
    ttmPsRatio: float | None

@app.post("/analyze")
@limiter.limit("5/minute")
async def analyze_stock(request: Request, body: AnalysisRequest, _: None = Depends(verify_token)):
    cache_key = f"analysis:{body.ticker}"
    cached = r.get(cache_key)
    if cached:
        print(f"Cache hit for analysis {body.ticker}")
        return json.loads(cached)

    def fmt(v, suffix=""):
        return f"{v}{suffix}" if v is not None else "N/A"

    try:
        prompt = f"""You are a financial analyst. Analyze this stock and return a JSON response only, no markdown, no backticks.

Stock: {body.ticker} ({body.name})
Price: ${body.price}
Change: {body.change:.2f}%
Market Cap: {body.marketCap}
P/E Ratio (TTM): {fmt(body.peRatio)}
Forward P/E: {fmt(body.forwardPE)}
52-week High: ${body.weekHigh52}
52-week Low: ${body.weekLow52}
Sector: {body.sector}
TTM EPS Growth: {fmt(body.ttmEpsGrowth, "%")}
TTM Revenue Growth: {fmt(body.ttmRevenueGrowth, "%")}
Gross Margin: {fmt(body.grossMargin, "%")}
Net Margin: {fmt(body.netMargin, "%")}
P/S Ratio (TTM): {fmt(body.ttmPsRatio)}
Description: {body.description}

Return this exact JSON structure:
{{
  "summary": "2-3 sentence overview of the company and current position",
  "bull_case": ["point 1", "point 2", "point 3"],
  "bear_case": ["point 1", "point 2", "point 3"],
  "sentiment": "bullish" | "bearish" | "neutral",
  "disclaimer": "This is not financial advice. Always do your own research."
}}"""

        message = client.messages.create(
            model=os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5"),
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}]
        )

        raw = message.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]
        if raw.endswith("```"):
            raw = raw.rsplit("```", 1)[0]
        raw = raw.strip()

        result = json.loads(raw)
        r.setex(cache_key, 3600, json.dumps(result))
        return result

    except Exception as e:
        print(f"ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
