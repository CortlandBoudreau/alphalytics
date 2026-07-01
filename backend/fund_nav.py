"""
fund_nav.py  —  estimate current NAV per unit for mutual funds whose
underlying equity holdings are stored in fund_holdings/{FUND_CODE}.json.

Strategy
--------
For each holding in the JSON:
  - Equity with a resolved ticker: fetch live price, compute
      estimated_value = disclosed_value * (live_price / disclosed_price_per_share)
  - Everything else (Fixed Income, Cash Equivalents, unmapped equities):
      estimated_value = disclosed_value  (static, as-of disclosure date)

NAV ratio = sum(estimated_values) / sum(disclosed_values)
Estimated NAV per unit = disclosed_nav_per_unit * NAV ratio

This is an approximation: bond mark-to-market moves and manager trades
since the disclosure date are not captured, but equity price moves (which
drive most day-to-day volatility) are reflected in real time.
"""

import json
import logging
import os
from typing import Optional

from quotes import fetch_quotes

logger = logging.getLogger(__name__)

HOLDINGS_DIR = os.path.join(os.path.dirname(__file__), "fund_holdings")

# Per-ticker price scale factor applied as:  ratio = live_price * scale / disclosed_price
#
# ADR/ADS (fund holds ordinary shares, we fetch the US depositary receipt):
#   scale = 1 / adr_ratio   e.g. TSM: 1 ADS = 5 ordinary → scale = 0.2
#
# Post-split (disclosed price is pre-split, live price is post-split):
#   scale = split_ratio      e.g. KLAC 10:1 split → scale = 10.0
_PRICE_SCALE: dict[str, float] = {
    # Global fallback scales for tickers that always need adjustment regardless
    # of which fund holds them.  Prefer storing price_scale on the JSON holding
    # entry (fund-specific) so the same ticker can have different bases in
    # different funds (e.g. TSM ordinary shares in CIF840 vs TSM ADS in FID265).
}


def _load_holdings(fund_code: str) -> Optional[dict]:
    path = os.path.join(HOLDINGS_DIR, f"{fund_code}.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def estimate_nav(fund_code: str) -> Optional[dict]:
    """
    Return a dict with the estimated current NAV per unit plus metadata,
    or None if no holdings file exists for this fund.

    Two pricing methods:
      "proxy"    — fund-of-funds with no individual equity holdings; NAV is
                   estimated by scaling the disclosed NAV by the price movement
                   of a proxy ETF since the disclosure date.
      "holdings" — standard look-through: live-price each mapped equity holding
                   and reweight the disclosed NAV accordingly.

    Return shape:
        {
            "fund_code":              "CIF840",
            "disclosed_nav_per_unit": 18.608,
            "estimated_nav_per_unit": 19.41,
            "nav_change_pct":         4.31,
            "equity_coverage_pct":    60.5,
            "tickers_priced":         68,
            "tickers_total":          70,
        }
    """
    data = _load_holdings(fund_code)
    if data is None:
        logger.debug("fund_nav: no holdings file for %s", fund_code)
        return None

    disclosed_nav = data["disclosed_nav_per_unit"]

    # ── Proxy method (fund-of-funds) ────────────────────────────────────────
    if data.get("pricing_method") == "proxy":
        proxy_ticker     = data.get("proxy_ticker")
        proxy_base_price = data.get("proxy_price_on_disclosure")
        if not proxy_ticker or not proxy_base_price:
            return None
        try:
            quotes = fetch_quotes([proxy_ticker])
            current_price = quotes[proxy_ticker]["price"]
        except Exception:
            logger.exception("fund_nav: proxy fetch failed for %s (%s)", fund_code, proxy_ticker)
            return None

        nav_ratio      = current_price / proxy_base_price
        estimated_nav  = round(disclosed_nav * nav_ratio, 4)
        nav_change_pct = round((nav_ratio - 1) * 100, 2)

        logger.info(
            "fund_nav: %s [proxy=%s]  disclosed=%.4f  estimated=%.4f  "
            "proxy %.4f -> %.4f  ratio=%.4f",
            fund_code, proxy_ticker, disclosed_nav, estimated_nav,
            proxy_base_price, current_price, nav_ratio,
        )
        return {
            "fund_code":              fund_code,
            "disclosed_nav_per_unit": disclosed_nav,
            "estimated_nav_per_unit": estimated_nav,
            "nav_change_pct":         nav_change_pct,
            "equity_coverage_pct":    0,
            "tickers_priced":         1,
            "tickers_total":          1,
            "pricing_method":         "proxy",
            "proxy_ticker":           proxy_ticker,
        }

    # ── Holdings look-through method ────────────────────────────────────────
    holdings        = data["holdings"]
    total_disclosed = data["total_disclosed_nav"]

    if total_disclosed <= 0:
        return None

    equity_tickers = list({
        h["ticker"]
        for h in holdings
        if h.get("ticker") and h["asset_type"].lower() == "equity"
    })

    live_prices: dict[str, float] = {}
    if equity_tickers:
        try:
            quotes = fetch_quotes(equity_tickers)
            live_prices = {t: q["price"] for t, q in quotes.items()}
        except Exception:
            logger.exception("fund_nav: fetch_quotes failed for %s", fund_code)

    tickers_priced = 0
    total_estimated = 0.0

    for h in holdings:
        mv     = h["disclosed_market_value"]
        ticker = h.get("ticker")

        if ticker and h["asset_type"].lower() == "equity" and ticker in live_prices:
            # Prefer explicitly stored disclosed_price (Fidelity format / historical fetch)
            # Fall back to disclosed_market_value / shares (Capital Group format)
            disclosed_price = h.get("disclosed_price")
            if not disclosed_price:
                shares = h.get("shares") or 0
                disclosed_price = (mv / shares) if shares > 0 else None

            if disclosed_price and disclosed_price > 0:
                scale = h.get("price_scale") or _PRICE_SCALE.get(ticker, 1.0)
                ratio = live_prices[ticker] * scale / disclosed_price
                # Guard against remaining basis mismatches and stale OTC data.
                # A >3x or <0.33x move in one quarter is almost certainly bad data.
                if 0.33 <= ratio <= 3.0:
                    total_estimated += mv * ratio
                    tickers_priced += 1
                    continue
                else:
                    logger.warning(
                        "fund_nav: %s ticker %s ratio %.3f out of bounds "
                        "(disclosed=%.4f live=%.4f) — falling back to static",
                        fund_code, ticker, ratio, disclosed_price, live_prices[ticker],
                    )

        # Fixed income, cash, convertible, or unresolved equity → use disclosed value
        total_estimated += mv

    nav_ratio = total_estimated / total_disclosed
    estimated_nav = round(disclosed_nav * nav_ratio, 4)
    nav_change_pct = round((nav_ratio - 1) * 100, 2)

    # ── Benchmark drift check ────────────────────────────────────────────────
    benchmark_nav   = None
    drift_pct       = None
    drift_alert     = False
    benchmark_blend = data.get("benchmark_blend", [])
    if benchmark_blend:
        try:
            bench_tickers  = [b["ticker"] for b in benchmark_blend]
            bench_quotes   = fetch_quotes(bench_tickers)
            blended_ratio  = sum(
                b["weight"] * (bench_quotes[b["ticker"]]["price"] / b["base_price"])
                for b in benchmark_blend
                if b["ticker"] in bench_quotes
            )
            benchmark_nav  = round(disclosed_nav * blended_ratio, 4)
            drift_pct      = round(((estimated_nav - benchmark_nav) / benchmark_nav) * 100, 2)
            drift_alert    = abs(drift_pct) > 5.0
            if drift_alert:
                bench_label = " / ".join(
                    f"{b['ticker']} {int(b['weight']*100)}%" for b in benchmark_blend
                )
                logger.warning(
                    "fund_nav: %s drift alert — holdings %.4f vs benchmark %.4f [%s] (%.2f%%)",
                    fund_code, estimated_nav, benchmark_nav, bench_label, drift_pct,
                )
        except Exception:
            logger.exception("fund_nav: benchmark check failed for %s", fund_code)

    logger.info(
        "fund_nav: %s  disclosed=%.4f  estimated=%.4f  ratio=%.4f  "
        "priced=%d/%d  coverage=%.1f%%",
        fund_code, disclosed_nav, estimated_nav, nav_ratio,
        tickers_priced, len(equity_tickers),
        data.get("equity_coverage_pct", 0),
    )

    return {
        "fund_code":              fund_code,
        "disclosed_nav_per_unit": disclosed_nav,
        "estimated_nav_per_unit": estimated_nav,
        "nav_change_pct":         nav_change_pct,
        "equity_coverage_pct":    data.get("equity_coverage_pct", 0),
        "tickers_priced":         tickers_priced,
        "tickers_total":          len(equity_tickers),
        "benchmark_nav":          benchmark_nav,
        "drift_pct":              drift_pct,
        "drift_alert":            drift_alert,
    }


def estimate_nav_batch(fund_codes: list[str]) -> dict[str, Optional[dict]]:
    """Estimate NAV for multiple funds in one call (shared Yahoo session)."""
    return {code: estimate_nav(code) for code in fund_codes}
