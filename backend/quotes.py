import json
import logging
from screener import _yf_session_and_crumb, get_sp500_metadata

logger = logging.getLogger(__name__)

# Wikipedia GICS names → display names used in SECTOR_COLORS
_WIKI_SECTOR_MAP = {
    "Information Technology": "Technology",
    "Health Care":            "Healthcare",
    "Financials":             "Financial Services",
    "Consumer Discretionary": "Consumer Discretionary",
    "Consumer Staples":       "Consumer Staples",
    "Materials":              "Materials",
    "Industrials":            "Industrials",
    "Energy":                 "Energy",
    "Real Estate":            "Real Estate",
    "Utilities":              "Utilities",
    "Communication Services": "Communication Services",
}


def fetch_sectors(ticker_list: list[str]) -> dict[str, str]:
    """
    Resolve sector for each ticker.  Priority:

    1. Per-ticker Redis cache (sector:{ticker}) — 24h TTL.
    2. S&P 500 Wikipedia metadata via get_sp500_metadata() — self-caching,
       covers ~500 US stocks with zero Yahoo Finance API calls.
    3. Yahoo Finance quoteSummary API — sequential, for non-S&P-500 names
       (Canadian TSX stocks etc.).  Falls back to .TO suffix automatically.

    Returns {original_ticker: sector_string}.
    """
    from db import r

    # Fetch S&P 500 metadata (populates sp500:metadata in Redis if missing)
    sp500_meta: dict = get_sp500_metadata()
    logger.info("sectors: sp500_meta has %d entries", len(sp500_meta))

    result: dict[str, str] = {}
    need_api: list[str] = []

    for t in ticker_list:
        # 1. Per-ticker cache (skip stale "Other" entries)
        cached = r.get(f"sector:{t}")
        if cached and cached.decode() not in ("Other", "N/A"):
            result[t] = cached.decode()
            logger.debug("sectors: %s from cache → %s", t, result[t])
            continue

        # 2. S&P 500 Wikipedia metadata
        entry = sp500_meta.get(t) or sp500_meta.get(t.replace(".", "-"))
        wiki_sector = (entry or {}).get("sector", "")
        if wiki_sector and wiki_sector not in ("N/A", ""):
            sector = _WIKI_SECTOR_MAP.get(wiki_sector, wiki_sector)
            r.setex(f"sector:{t}", 86400, sector)
            result[t] = sector
            logger.info("sectors: %s from sp500 → %s (wiki: %s)", t, sector, wiki_sector)
            continue

        need_api.append(t)

    logger.info("sectors: %d resolved from cache/sp500, %d need API: %s",
                len(result), len(need_api), need_api)

    if not need_api:
        return result

    # 3. Yahoo Finance quoteSummary — one session, sequential (thread-safe)
    session, crumb = _yf_session_and_crumb()

    def _query_summary(ticker: str) -> str | None:
        try:
            resp = session.get(
                f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{ticker}",
                params={"modules": "assetProfile", "crumb": crumb, "formatted": "false"},
                headers={"Accept": "application/json"},
                timeout=15,
            )
            logger.debug("quoteSummary %s → status %s", ticker, resp.status_code)
            if not resp.ok:
                return None
            results = (resp.json().get("quoteSummary") or {}).get("result") or []
            if results:
                return results[0].get("assetProfile", {}).get("sector") or None
        except Exception:
            logger.exception("quoteSummary exception for %s", ticker)
        return None

    for t in need_api:
        sector = _query_summary(t)
        if not sector:
            to_ticker = t.replace(".", "-") + ".TO"
            sector = _query_summary(to_ticker)
            if sector:
                logger.info("sectors: %s resolved via %s → %s", t, to_ticker, sector)
        if not sector:
            logger.warning("sectors: could not resolve %s, storing Other", t)
        sector = sector or "Other"
        r.setex(f"sector:{t}", 86400, sector)
        result[t] = sector

    return result


def fetch_quotes(ticker_list: list[str]) -> dict:
    """
    Fetch live quotes for a list of tickers via Yahoo Finance.

    For any ticker that returns no price on the first pass, automatically
    retries with a .TO suffix (Canadian TSX stocks).  Class-share dots are
    converted to hyphens as Yahoo requires: CCL.B → CCL-B.TO.

    Returns a dict mapping the *original* ticker symbol to:
      { ticker, name, price, change }
    """
    session, crumb = _yf_session_and_crumb()

    def _yahoo_fetch(tickers: list[str]) -> dict:
        try:
            resp = session.get(
                "https://query2.finance.yahoo.com/v7/finance/quote",
                params={"symbols": ",".join(tickers), "crumb": crumb, "formatted": "false"},
                headers={"Accept": "application/json"},
                timeout=30,
            )
            if not resp.ok:
                logger.warning("Yahoo quote API returned %s", resp.status_code)
                return {}
        except Exception:
            logger.exception("Yahoo quote fetch failed")
            return {}

        result = {}
        for q in (resp.json().get("quoteResponse") or {}).get("result") or []:
            price = q.get("regularMarketPrice")
            if price is None:
                continue
            result[q["symbol"]] = {
                "ticker":   q["symbol"],
                "name":     q.get("shortName") or q["symbol"],
                "price":    round(float(price), 2),
                "change":   round(float(q.get("regularMarketChangePercent", 0)), 2),
                "currency": q.get("currency", "USD"),
            }
        return result

    # First pass — try tickers as-is (covers US exchanges)
    result = _yahoo_fetch(ticker_list)

    # Second pass — retry any missing tickers with .TO suffix.
    # Yahoo Finance TSX format: replace inner dots with hyphens, append .TO.
    # e.g. CCL.B → CCL-B.TO   REI.UN → REI-UN.TO   BMO → BMO.TO
    missing = [t for t in ticker_list if t not in result]
    if missing:
        to_map = {t.replace(".", "-") + ".TO": t for t in missing}
        to_result = _yahoo_fetch(list(to_map.keys()))
        for to_ticker, orig_ticker in to_map.items():
            if to_ticker in to_result:
                entry = to_result[to_ticker].copy()
                entry["ticker"] = orig_ticker  # restore original symbol
                result[orig_ticker] = entry
                logger.info("quotes: resolved %s via %s (%s)", orig_ticker, to_ticker, entry.get("currency", "?"))

    return result
