from db import r
import requests
import json
import os

SP500_TICKERS = [
    'MMM','AOS','ABT','ABBV','ACN','ADBE','AMD','AES','AFL','A','APD','ABNB','AKAM','ALB','ARE',
    'ALGN','ALLE','LNT','ALL','GOOGL','GOOG','MO','AMZN','AMCR','AEE','AAL','AEP','AXP','AIG',
    'AMT','AWK','AMP','AME','AMGN','APH','ADI','ANSS','AON','APA','AAPL','AMAT','APTV','ACGL',
    'ADM','ANET','AJG','AIZ','T','ATO','ADSK','ADP','AZO','AVB','AVY','AXON','BKR','BALL',
    'BAC','BAX','BDX','BRK-B','BBY','BIO','TECH','BIIB','BLK','BX','BA','BCR','BSX','BMY',
    'AVGO','BR','BRO','BF-B','BLDR','BG','CDNS','CZR','CPT','CPB','COF','CAH','KMX','CCL',
    'CARR','CTLT','CAT','CBOE','CBRE','CDW','CE','COR','CNC','CNX','CDAY','CF','CRL','SCHW',
    'CHTR','CVX','CMG','CB','CHD','CI','CINF','CTAS','CSCO','C','CFG','CLX','CME','CMS',
    'KO','CTSH','CL','CMCSA','CMA','CAG','COP','ED','STZ','CEG','COO','CPRT','GLW','CTVA',
    'CSGP','COST','CTRA','CCI','CSX','CMI','CVS','DHI','DHR','DRI','DVA','DAY','DECK','DE',
    'DAL','DVN','DXCM','FANG','DLR','DFS','DG','DLTR','D','DPZ','DOV','DOW','DTE',
    'DUK','DD','EMN','ETN','EBAY','ECL','EIX','EW','EA','ELV','LLY','EMR','ENPH','ETR',
    'EOG','EPAM','EQT','EFX','EQIX','EQR','ESS','EL','ETSY','EG','EVRG','ES','EXC','EXPE',
    'EXPD','EXR','XOM','FFIV','FDS','FICO','FAST','FRT','FDX','FIS','FITB','FSLR','FE','FI',
    'FMC','F','FTNT','FTV','FOXA','FOX','BEN','FCX','GRMN','IT','GE','GEHC','GEN','GNRC',
    'GD','GIS','GM','GPC','GILD','GPN','GL','GDDY','GS','HAL','HIG','HAS','HCA','DOC',
    'HSIC','HSY','HES','HPE','HLT','HOLX','HD','HON','HRL','HST','HWM','HPQ','HUBB','HUM',
    'HBAN','HII','IBM','IEX','IDXX','ITW','INCY','IR','PODD','INTC','ICE','IFF','IP','IPG',
    'INTU','ISRG','IVZ','INVH','IQV','IRM','JBHT','JBL','JKHY','J','JNJ','JCI','JPM','JNPR',
    'K','KVUE','KDP','KEY','KEYS','KMB','KIM','KMI','KLAC','KHC','KR','LHX','LH','LRCX',
    'LW','LVS','LDOS','LEN','LNC','LIN','LYV','LKQ','LMT','L','LOW','LULU','LYB','MTB',
    'MRO','MPC','MKTX','MAR','MMC','MLM','MAS','MA','MTCH','MKC','MCD','MCK','MDT','MRK',
    'META','MET','MTD','MGM','MCHP','MU','MSFT','MAA','MRNA','MHK','MOH','TAP','MDLZ',
    'MPWR','MNST','MCO','MS','MOS','MSI','MSCI','NDAQ','NTAP','NFLX','NEM','NWSA','NWS',
    'NEE','NKE','NI','NDSN','NSC','NTRS','NOC','NCLH','NRG','NUE','NVDA','NVR','NXPI',
    'ORLY','OXY','ODFL','OMC','ON','OKE','ORCL','OTIS','OGN','PCAR','PKG','PANW',
    'PH','PAYX','PAYC','PYPL','PNR','PEP','PFE','PCG','PM','PSX','PNW','PNC','POOL',
    'PPG','PPL','PFG','PG','PGR','PLD','PRU','PEG','PTC','PSA','PHM','QRVO','PWR','QCOM',
    'DGX','RL','RJF','RTX','O','REG','REGN','RF','RSG','RMD','RVTY','ROK','ROL','ROP',
    'ROST','RCL','SPGI','SLB','STX','SRE','NOW','SHW','SPG','SWKS','SJM','SNA','SOLV',
    'SO','LUV','SWK','SBUX','STT','STLD','STE','SYK','SYF','SNPS','SYY','TMUS','TROW',
    'TTWO','TPR','TRGP','TGT','TEL','TDY','TFX','TER','TSLA','TXN','TXT','TMO','TJX',
    'TSCO','TT','TDG','TRV','TRMB','TFC','TYL','TSN','USB','UDR','ULTA','UNP','UAL',
    'UPS','URI','UNH','UHS','VLO','VTR','VLTO','VRSN','VRSK','VZ','VRTX','VICI','V',
    'VMC','WRB','WAB','WMT','WBA','WM','WAT','WEC','WFC','WELL','WST','WDC','WRK','WY',
    'WHR','WMB','WTW','GWW','WYNN','XEL','XYL','YUM','ZBRA','ZBH','ZTS',
]
SP500_TICKERS = list(dict.fromkeys(SP500_TICKERS))

_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def get_sp500_tickers():
    meta = get_sp500_metadata()
    return list(meta.keys())


def get_sp500_metadata():
    """Fetch S&P 500 list with sector/industry/name from Wikipedia. Cached 7 days."""
    cached = r.get("sp500:metadata")
    if cached:
        return json.loads(cached)
    try:
        from bs4 import BeautifulSoup
        resp = requests.get(
            "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=15,
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        table = soup.find("table", {"id": "constituents"})
        data = {}
        for row in table.find("tbody").find_all("tr"):
            cols = row.find_all("td")
            if len(cols) < 4:
                continue
            ticker = cols[0].text.strip().replace(".", "-")
            data[ticker] = {
                "name": cols[1].text.strip(),
                "sector": cols[2].text.strip(),
                "industry": cols[3].text.strip(),
            }
        r.setex("sp500:metadata", 86400 * 7, json.dumps(data))
        print(f"Loaded S&P 500 metadata: {len(data)} companies")
        return data
    except Exception as e:
        print(f"Wikipedia metadata fetch failed, using fallback: {e}")
        return {t: {"name": t, "sector": "N/A", "industry": "N/A"} for t in SP500_TICKERS}


def _yf_session_and_crumb():
    """Return a requests.Session with Yahoo Finance cookies and a valid crumb."""
    session = requests.Session()
    session.headers.update(_BROWSER_HEADERS)
    session.get("https://finance.yahoo.com", timeout=10)
    for host in ("query2", "query1"):
        crumb_resp = session.get(
            f"https://{host}.finance.yahoo.com/v1/test/getcrumb", timeout=10
        )
        if crumb_resp.ok and crumb_resp.text.strip():
            return session, crumb_resp.text.strip()
    raise RuntimeError(f"Could not fetch YF crumb (last status {crumb_resp.status_code})")


def _fmt_mc(n):
    if not n:
        return None
    if n >= 1_000_000_000_000:
        return f"${n/1_000_000_000_000:.2f}T"
    if n >= 1_000_000_000:
        return f"${n/1_000_000_000:.2f}B"
    if n >= 1_000_000:
        return f"${n/1_000_000:.2f}M"
    return f"${n:,.0f}"


def load_tickers_into_redis():
    try:
        print("Loading tickers from SEC EDGAR...")
        response = requests.get(
            "https://www.sec.gov/files/company_tickers.json",
            headers={"User-Agent": "Alphalytics contact@alphalytics.com"}
        )
        data = response.json()
        tickers = [{"ticker": item["ticker"].upper(), "name": item["title"]} for item in data.values()]
        r.setex("tickers", 86400, json.dumps(tickers))
        print(f"Loaded {len(tickers)} tickers into Redis")
        return tickers
    except Exception as e:
        print(f"Error loading tickers: {str(e)}")
        return []


def build_screener_data():
    """Fetch S&P 500 metrics via Yahoo Finance bulk quote API. ~5 HTTP calls total."""
    try:
        sp500 = get_sp500_metadata()
        tickers = list(sp500.keys())

        session, crumb = _yf_session_and_crumb()

        quote_lookup: dict = {}
        for i in range(0, len(tickers), 200):
            batch = ",".join(tickers[i:i + 200])
            resp = session.get(
                "https://query2.finance.yahoo.com/v7/finance/quote",
                params={"symbols": batch, "crumb": crumb, "formatted": "false"},
                headers={"Accept": "application/json"},
                timeout=30,
            )
            if resp.ok:
                for q in (resp.json().get("quoteResponse") or {}).get("result") or []:
                    quote_lookup[q["symbol"]] = q
            else:
                print(f"[screener] YF quote batch {i//200+1} failed: {resp.status_code} {resp.text[:200]}")

        def _r2(v):
            return round(float(v), 2) if v is not None else None

        def _pct(v):
            return round(float(v) * 100, 2) if v is not None else None

        results = []
        for ticker, meta in sp500.items():
            q = quote_lookup.get(ticker, {})
            price = q.get("regularMarketPrice")
            if not price:
                continue
            mc = q.get("marketCap") or 0
            results.append({
                "ticker": ticker,
                "name": q.get("shortName") or meta["name"],
                "sector": meta["sector"],
                "industry": meta["industry"],
                "price": round(float(price), 2),
                "change": round(float(q.get("regularMarketChangePercent", 0)), 2),
                "marketCap": _fmt_mc(mc),
                "marketCapRaw": mc,
                "peRatio": _r2(q.get("trailingPE")),
                "pbRatio": _r2(q.get("priceToBook")),
                "beta": _r2(q.get("beta")),
                "dividendYield": _pct(q.get("trailingAnnualDividendYield")),
                "weekChange52": _pct(q.get("fiftyTwoWeekChangePercent")),
            })

        print(f"Screener built: {len(results)} stocks")
        if results:
            r.setex("screener:data", 86400, json.dumps(results))
        return results

    except Exception as e:
        print(f"Screener build error: {e}")
        return []
