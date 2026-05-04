import os
from pathlib import Path
from dotenv import load_dotenv

env = os.getenv("ENV", "development")
base_env = Path(__file__).parent / ".env"
if base_env.exists():
    load_dotenv(dotenv_path=base_env)
env_file = Path(__file__).parent / f".env.{env}"
if env_file.exists():
    load_dotenv(dotenv_path=env_file, override=True)

from fastapi import FastAPI, Request, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import yfinance as yf
import pandas as pd
import json

from db import r
from auth import security, verify_token
from screener import build_screener_data, load_tickers_into_redis, _yf_session_and_crumb
from financials import build_income_quarters, build_balance_quarters, build_cashflow_quarters
from ai import call_claude, AnalysisRequest, client

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
        return load_tickers_into_redis()
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

        hist = stock.history(period="2y", interval="1d")
        hist["ma50"]  = hist["Close"].rolling(50).mean()
        hist["ma200"] = hist["Close"].rolling(200).mean()
        display = hist.tail(252)
        chart_data = []
        for date, row in display.iterrows():
            chart_data.append({
                "date":   date.strftime("%b '%y"),
                "price":  round(float(row["Close"]), 2),
                "volume": int(row["Volume"]),
                "ma50":   round(float(row["ma50"]),  2) if not pd.isna(row["ma50"])  else None,
                "ma200":  round(float(row["ma200"]), 2) if not pd.isna(row["ma200"]) else None,
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
@limiter.limit("30/minute")
async def get_screener_data(request: Request, _: None = Depends(verify_token)):
    cached = r.get("screener:data")
    if cached:
        return json.loads(cached)
    data = build_screener_data()
    if not data:
        raise HTTPException(status_code=503, detail="Failed to build screener data.")
    return data


@app.post("/screener/refresh")
@limiter.limit("5/hour")
async def refresh_screener(request: Request, _: None = Depends(verify_token)):
    r.delete("screener:data")
    data = build_screener_data()
    if not data:
        raise HTTPException(status_code=503, detail="Failed to rebuild screener data.")
    return {"status": "ok", "count": len(data)}


# ── News ──────────────────────────────────────────────────────────────────────

@app.get("/news/{ticker}")
@limiter.limit("10/minute")
async def get_news(request: Request, ticker: str, _: None = Depends(verify_token)):
    ticker = "".join(c for c in ticker.upper() if c.isalnum() or c == "-")
    if not ticker or len(ticker) > 10:
        raise HTTPException(status_code=400, detail="Invalid ticker")

    cache_key = f"news:{ticker}"
    cached = r.get(cache_key)
    if cached:
        return json.loads(cached)

    try:
        raw = yf.Ticker(ticker).news or []
        news = []
        for item in raw[:8]:
            # yfinance 1.x wraps items under a "content" key
            content = item.get("content") if isinstance(item, dict) else None
            if content:
                title     = content.get("title", "")
                publisher = (content.get("provider") or {}).get("displayName", "")
                url       = (content.get("canonicalUrl") or content.get("clickThroughUrl") or {}).get("url", "")
                pub_date  = content.get("pubDate", "")
                thumb     = (content.get("thumbnail") or {}).get("originalUrl")
            else:
                title     = item.get("title", "")
                publisher = item.get("publisher", "")
                url       = item.get("link", "")
                pub_date  = item.get("providerPublishTime", 0)
                resolutions = (item.get("thumbnail") or {}).get("resolutions") or []
                thumb     = resolutions[0].get("url") if resolutions else None

            if title and url:
                news.append({
                    "title":       title,
                    "publisher":   publisher,
                    "url":         url,
                    "publishedAt": pub_date,
                    "thumbnail":   thumb,
                })

        r.setex(cache_key, 1800, json.dumps(news))
        return news
    except Exception as e:
        print(f"ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Bulk Quotes (portfolio) ────────────────────────────────────────────────────

@app.get("/quotes")
@limiter.limit("30/minute")
async def get_quotes(request: Request, tickers: str, _: None = Depends(verify_token)):
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()][:50]
    if not ticker_list:
        return {}

    cache_key = f"quotes:{','.join(sorted(ticker_list))}"
    cached = r.get(cache_key)
    if cached:
        return json.loads(cached)

    try:
        session, crumb = _yf_session_and_crumb()
        resp = session.get(
            "https://query2.finance.yahoo.com/v7/finance/quote",
            params={"symbols": ",".join(ticker_list), "crumb": crumb, "formatted": "false"},
            headers={"Accept": "application/json"},
            timeout=30,
        )
        if not resp.ok:
            raise HTTPException(status_code=502, detail="Failed to fetch quotes")

        result = {}
        for q in (resp.json().get("quoteResponse") or {}).get("result") or []:
            result[q["symbol"]] = {
                "ticker": q["symbol"],
                "name":   q.get("shortName") or q["symbol"],
                "price":  round(float(q["regularMarketPrice"]), 2),
                "change": round(float(q.get("regularMarketChangePercent", 0)), 2),
            }

        r.setex(cache_key, 300, json.dumps(result))
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Income Statement ───────────────────────────────────────────────────────────

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
