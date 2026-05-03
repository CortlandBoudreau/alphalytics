from fastapi import FastAPI, Request, HTTPException, Depends, Query
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

allowed_origins = [
    "http://localhost:5173",
    "http://localhost:5174",
]

extra_origins = os.getenv("ALLOWED_ORIGINS", "")
if extra_origins:
    allowed_origins.extend([o.strip() for o in extra_origins.split(",")])

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

# ── S&P 500 ticker universe ────────────────────────────────────────────────────

SP500_TICKERS = [
    'AAPL','MSFT','NVDA','AMZN','GOOGL','GOOG','META','BRK-B','TSLA','AVGO',
    'JPM','LLY','V','UNH','XOM','MA','COST','HD','PG','JNJ',
    'ABBV','BAC','NFLX','CRM','CVX','MRK','WMT','KO','PEP','ORCL',
    'TMO','ACN','MCD','CSCO','ABT','AMD','GE','DHR','LIN','ADBE',
    'IBM','NOW','TXN','PM','QCOM','INTU','GS','ISRG','RTX','NEE',
    'AMGN','SPGI','CAT','UNP','LOW','HON','UBER','BKNG','MS','T',
    'AXP','AMAT','SYK','ELV','BLK','DE','VRTX','GILD','MDT','REGN',
    'PLD','BSX','PANW','ADI','MU','LRCX','KLAC','ETN','CB','SO',
    'DUK','CI','MMC','ZTS','CME','TJX','WFC','AON','ICE','ITW',
    'EMR','SHW','APH','MCO','PH','CDNS','SNPS','WELL','MCK','NOC',
    'GD','FI','CTAS','ECL','HCA','EW','COF','USB','NSC','HUM',
    'F','GM','PYPL','INTC','DELL','HPQ','MO','PSA','WM','RSG',
    'CARR','OTIS','PWR','FAST','ODFL','VRSK','IDXX','IQV','FICO','MPWR',
    'NEM','FCX','DOW','LYB','PPG','APD','NUE','STLD','MLM','VMC',
    'IR','XYL','CTSH','ANSS','PTC','CSX','KDP','STZ','CL','GIS',
    'K','CPB','HRL','MKC','TSN','CAG','MDLZ','MNST','ADM','CF',
    'ALB','BALL','PKG','IP','AMCR','CCK','DG','DLTR','TGT','KR',
    'SYY','BDX','BAX','HOLX','ALGN','DXCM','ILMN','MTD','WAT','A',
    'PFE','BMY','BIIB','MRNA','LMT','BA','HII','TDG','HEI','TXT',
    'SPG','AMT','CCI','EQIX','DLR','EXR','VTR','SBAC','SBA',
    'NEE','EXC','AEP','XEL','WEC','ES','CMS','AWK','SRE','PCG',
    'CVX','COP','EOG','PXD','DVN','APA','MRO','OXY','HES','VLO',
    'PSX','MPC','LMT','RTX','NOC','GD','BA','SCHW','STT','BK',
    'AIG','MET','PRU','LNC','TRV','ALL','PGR','CINF',
    'SNOW','DDOG','ZS','CRWD','NET','OKTA','MDB','ESTC','GTLB','HUBS',
    'SHOP','SQ','COIN','HOOD','SOFI','AFRM','UPST','LC','DAVE','NU',
    'PLTR','AI','BBAI','SOUN','ASTS','RKLB','LUNR','PL','SPIR','IRDM',
]

def get_sp500_tickers():
    """Fetch current S&P 500 tickers from Wikipedia."""
    cached = r.get("sp500:tickers")
    if cached:
        return json.loads(cached)
    try:
        import pandas as pd
        table = pd.read_html("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies")
        tickers = table[0]["Symbol"].tolist()
        # Fix known yfinance ticker differences
        tickers = [t.replace(".", "-") for t in tickers]
        r.setex("sp500:tickers", 86400 * 7, json.dumps(tickers))  # cache 7 days
        print(f"Loaded {len(tickers)} S&P 500 tickers from Wikipedia")
        return tickers
    except Exception as e:
        print(f"Wikipedia fetch failed, using fallback: {e}")
        return SP500_TICKERS  # fall back to hardcoded list

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

def build_screener_data():
    """Fetch key metrics for all S&P 500 tickers and cache in Redis."""
    print("Building screener data...")
    results = []
    for ticker in get_sp500_tickers():
        try:
            stock = yf.Ticker(ticker)
            info = stock.info
            if not info:
                continue

            price = info.get("currentPrice") or info.get("regularMarketPrice")
            if not price:
                continue

            market_cap = info.get("marketCap", 0)

            def fmt_mc(n):
                if not n:
                    return None
                if n >= 1_000_000_000_000:
                    return f"${n/1_000_000_000_000:.2f}T"
                if n >= 1_000_000_000:
                    return f"${n/1_000_000_000:.2f}B"
                if n >= 1_000_000:
                    return f"${n/1_000_000:.2f}M"
                return f"${n:,.0f}"

            def fp(v):
                if v is None:
                    return None
                return round(v * 100, 2)

            def fr(v):
                if v is None:
                    return None
                return round(v, 2)

            results.append({
                "ticker": ticker,
                "name": info.get("longName", ticker),
                "sector": info.get("sector", "N/A"),
                "industry": info.get("industry", "N/A"),
                "price": round(price, 2),
                "change": round(info.get("regularMarketChangePercent", 0), 2),
                "marketCap": fmt_mc(market_cap),
                "marketCapRaw": market_cap,
                "peRatio": fr(info.get("trailingPE")),
                "forwardPE": fr(info.get("forwardPE")),
                "psRatio": fr(info.get("priceToSalesTrailing12Months")),
                "revenueGrowth": fp(info.get("revenueGrowth")),
                "epsGrowth": fp(info.get("earningsGrowth")),
                "grossMargin": fp(info.get("grossMargins")),
                "netMargin": fp(info.get("profitMargins")),
                "roe": fp(info.get("returnOnEquity")),
                "debtToEquity": fr(info.get("debtToEquity")),
            })
        except Exception as e:
            print(f"Screener skip {ticker}: {e}")
            continue

    print(f"Screener built: {len(results)} stocks")
    r.setex("screener:data", 86400, json.dumps(results))  # 24hr cache
    return results

@app.on_event("startup")
async def startup_event():
    if not r.exists("tickers"):
        load_tickers_into_redis()
    else:
        print("Tickers already cached in Redis")
    # Don't pre-build screener on startup — too slow. Build on first request.

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


# ── Screener ───────────────────────────────────────────────────────────────────

@app.get("/screener/data")
@limiter.limit("5/minute")
async def get_screener_data(request: Request, _: None = Depends(verify_token)):
    """Return the full screener dataset. Build if not cached."""
    cached = r.get("screener:data")
    if cached:
        return json.loads(cached)
    # Build on first request (takes ~2-3 min for 300+ tickers)
    # Return building status so frontend can poll
    building = r.get("screener:building")
    if building:
        raise HTTPException(status_code=202, detail="Screener data is being built. Try again in a moment.")
    # Kick off build
    r.setex("screener:building", 300, "1")
    try:
        data = build_screener_data()
        r.delete("screener:building")
        return data
    except Exception as e:
        r.delete("screener:building")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/screener/refresh")
@limiter.limit("1/hour")
async def refresh_screener(request: Request, _: None = Depends(verify_token)):
    """Force rebuild the screener dataset."""
    r.delete("screener:data")
    building = r.get("screener:building")
    if building:
        raise HTTPException(status_code=202, detail="Already building.")
    r.setex("screener:building", 300, "1")
    try:
        data = build_screener_data()
        r.delete("screener:building")
        return {"status": "ok", "count": len(data)}
    except Exception as e:
        r.delete("screener:building")
        raise HTTPException(status_code=500, detail=str(e))


# ── Shared helpers ─────────────────────────────────────────────────────────────

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

def call_claude(prompt: str, max_tokens: int = 512) -> dict:
    message = client.messages.create(
        model=os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5"),
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}]
    )
    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]
    return json.loads(raw.strip())


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


@app.get("/income/{ticker}")
@limiter.limit("10/minute")
async def get_income(request: Request, ticker: str, period: str = Query(default="quarterly"), _: None = Depends(verify_token)):
    ticker = "".join(c for c in ticker.upper() if c.isalnum() or c == "-")
    if not ticker or len(ticker) > 10:
        raise HTTPException(status_code=400, detail="Invalid ticker")
    period = period if period in ("quarterly", "annual") else "quarterly"

    cache_key = f"income:data:{ticker}:{period}"
    cached = r.get(cache_key)
    if cached:
        return json.loads(cached)

    try:
        quarter_data, info = build_income_quarters(ticker, period)
        result = {
            "ticker": ticker,
            "name": info.get("longName", ticker),
            "sector": info.get("sector", "N/A"),
            "quarters": quarter_data,
        }
        r.setex(cache_key, 900, json.dumps(result))
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/income/{ticker}/analysis")
@limiter.limit("5/minute")
async def get_income_analysis(request: Request, ticker: str, period: str = Query(default="quarterly"), _: None = Depends(verify_token)):
    ticker = "".join(c for c in ticker.upper() if c.isalnum() or c == "-")
    if not ticker or len(ticker) > 10:
        raise HTTPException(status_code=400, detail="Invalid ticker")
    period = period if period in ("quarterly", "annual") else "quarterly"

    cache_key = f"income:analysis:{ticker}:{period}"
    cached = r.get(cache_key)
    if cached:
        return json.loads(cached)

    try:
        quarter_data, info = build_income_quarters(ticker, period)
        sector = info.get("sector", "Unknown")
        name   = info.get("longName", ticker)
        period_word = "annual" if period == "annual" else "quarterly"
        period_unit = "year" if period == "annual" else "quarter"

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
  R&D: ${q['rdExpense']}M | SG&A: ${q['sgaExpense']}M
  EBITDA: ${q['ebitda']}M | Tax: ${q['taxProvision']}M
""")

        prompt = f"""You are a financial analyst grading {period_word} income statements for {name} ({ticker}), sector: {sector}.

Grade each {period_unit} AND provide an overall grade: A+, A, A-, B+, B, B-, C+, C, C-, D, F

Criteria (contextual by sector):
- Revenue growth rate and trend
- Expense growth vs revenue growth
- Operating and net income growth
- Margin trends
- One-time items and EPS growth

{''.join(quarters_summary)}

Return ONLY this JSON, no markdown, no backticks:
{{
  "overall_grade": "A",
  "overall_summary": "2-3 sentence summary",
  "quarter_grades": [
    {{"label": "{quarter_data[0]['label'] if quarter_data else ''}", "grade": "A", "note": "one sentence"}}
  ],
  "flags": ["short flag, max 15 words, 0-3 total"],
  "sentiment": "bullish",
  "disclaimer": "This is not financial advice. Always do your own research."
}}
"""
        grading = call_claude(prompt, max_tokens=1024)
        r.setex(cache_key, 3600, json.dumps(grading))
        return grading
    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


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


@app.get("/balance/{ticker}")
@limiter.limit("10/minute")
async def get_balance(request: Request, ticker: str, period: str = Query(default="quarterly"), _: None = Depends(verify_token)):
    ticker = "".join(c for c in ticker.upper() if c.isalnum() or c == "-")
    if not ticker or len(ticker) > 10:
        raise HTTPException(status_code=400, detail="Invalid ticker")
    period = period if period in ("quarterly", "annual") else "quarterly"

    cache_key = f"balance:data:{ticker}:{period}"
    cached = r.get(cache_key)
    if cached:
        return json.loads(cached)

    try:
        quarter_data, info = build_balance_quarters(ticker, period)
        result = {
            "ticker": ticker,
            "name": info.get("longName", ticker),
            "sector": info.get("sector", "N/A"),
            "quarters": quarter_data,
        }
        r.setex(cache_key, 900, json.dumps(result))
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/balance/{ticker}/analysis")
@limiter.limit("5/minute")
async def get_balance_analysis(request: Request, ticker: str, period: str = Query(default="quarterly"), _: None = Depends(verify_token)):
    ticker = "".join(c for c in ticker.upper() if c.isalnum() or c == "-")
    if not ticker or len(ticker) > 10:
        raise HTTPException(status_code=400, detail="Invalid ticker")
    period = period if period in ("quarterly", "annual") else "quarterly"

    cache_key = f"balance:analysis:{ticker}:{period}"
    cached = r.get(cache_key)
    if cached:
        return json.loads(cached)

    try:
        quarter_data, info = build_balance_quarters(ticker, period)
        sector = info.get("sector", "Unknown")
        name   = info.get("longName", ticker)
        q      = quarter_data[0]

        prompt = f"""You are a financial analyst reviewing the balance sheet for {name} ({ticker}), sector: {sector}.

Most recent quarter ({q['label']}):
  Total Assets: ${q['totalAssets']}M | Current Assets: ${q['currentAssets']}M
  Cash: ${q['cash']}M | Short Term Investments: ${q['shortTermInvestments']}M
  Accounts Receivable: ${q['accountsReceivable']}M | Inventory: ${q['inventory']}M
  Total Liabilities: ${q['totalLiabilities']}M | Current Liabilities: ${q['currentLiabilities']}M
  Long Term Debt: ${q['longTermDebt']}M | Total Debt: ${q['totalDebt']}M | Net Debt: ${q['netDebt']}M
  Stockholders Equity: ${q['stockholdersEquity']}M | Retained Earnings: ${q['retainedEarnings']}M
  Working Capital: ${q['workingCapital']}M
  Current Ratio: {q['currentRatio']} | Debt/Equity: {q['debtToEquity']} | Debt/Assets: {q['debtToAssets']}

Return ONLY this JSON, no markdown, no backticks:
{{
  "summary": "2-3 sentence assessment of balance sheet health, liquidity, and leverage",
  "flags": ["short flag, max 15 words, 0-3 total"],
  "health": "strong",
  "disclaimer": "This is not financial advice. Always do your own research."
}}
"""
        analysis = call_claude(prompt)
        r.setex(cache_key, 3600, json.dumps(analysis))
        return analysis
    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


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


@app.get("/cashflow/{ticker}")
@limiter.limit("10/minute")
async def get_cashflow(request: Request, ticker: str, period: str = Query(default="quarterly"), _: None = Depends(verify_token)):
    ticker = "".join(c for c in ticker.upper() if c.isalnum() or c == "-")
    if not ticker or len(ticker) > 10:
        raise HTTPException(status_code=400, detail="Invalid ticker")
    period = period if period in ("quarterly", "annual") else "quarterly"

    cache_key = f"cashflow:data:{ticker}:{period}"
    cached = r.get(cache_key)
    if cached:
        return json.loads(cached)

    try:
        quarter_data, info = build_cashflow_quarters(ticker, period)
        result = {
            "ticker": ticker,
            "name": info.get("longName", ticker),
            "sector": info.get("sector", "N/A"),
            "quarters": quarter_data,
        }
        r.setex(cache_key, 900, json.dumps(result))
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/cashflow/{ticker}/analysis")
@limiter.limit("5/minute")
async def get_cashflow_analysis(request: Request, ticker: str, period: str = Query(default="quarterly"), _: None = Depends(verify_token)):
    ticker = "".join(c for c in ticker.upper() if c.isalnum() or c == "-")
    if not ticker or len(ticker) > 10:
        raise HTTPException(status_code=400, detail="Invalid ticker")
    period = period if period in ("quarterly", "annual") else "quarterly"

    cache_key = f"cashflow:analysis:{ticker}:{period}"
    cached = r.get(cache_key)
    if cached:
        return json.loads(cached)

    try:
        quarter_data, info = build_cashflow_quarters(ticker, period)
        sector = info.get("sector", "Unknown")
        name   = info.get("longName", ticker)
        q      = quarter_data[0]

        prompt = f"""You are a financial analyst reviewing cash flow statements for {name} ({ticker}), sector: {sector}.

Most recent quarter ({q['label']}):
  Operating Cash Flow: ${q['operatingCashFlow']}M (YoY: {q['yoy']['operatingCashFlow']}%)
  Free Cash Flow: ${q['freeCashFlow']}M (YoY: {q['yoy']['freeCashFlow']}%)
  Net Income: ${q['netIncome']}M | D&A: ${q['da']}M
  Capex: ${q['capex']}M (YoY: {q['yoy']['capex']}%)
  Stock Based Comp: ${q['stockBasedComp']}M
  Investing Cash Flow: ${q['investingCashFlow']}M
  Financing Cash Flow: ${q['financingCashFlow']}M
  Dividends: ${q['dividendsPaid']}M | Buybacks: ${q['stockBuybacks']}M
  FCF/Net Income: {q['fcfToNetIncome']} | End Cash: ${q['endCashPosition']}M

Return ONLY this JSON, no markdown, no backticks:
{{
  "summary": "2-3 sentence assessment of cash generation, capital allocation, and earnings quality",
  "flags": ["short flag, max 15 words, 0-3 total"],
  "quality": "excellent",
  "disclaimer": "This is not financial advice. Always do your own research."
}}
"""
        analysis = call_claude(prompt)
        r.setex(cache_key, 3600, json.dumps(analysis))
        return analysis
    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Analyze ────────────────────────────────────────────────────────────────────

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
