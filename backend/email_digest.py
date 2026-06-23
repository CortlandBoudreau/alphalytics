import os
import json
import logging
from datetime import datetime

from db import r
from quotes import fetch_quotes, fetch_sectors, fetch_week_opens

logger = logging.getLogger(__name__)

SECTOR_COLORS = {
    # yfinance / quoteSummary names
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
    # Wikipedia / GICS names (used by sp500:metadata)
    "Financials":             "#f59e0b",
    "Consumer Discretionary": "#ec4899",
    "Consumer Staples":       "#8b5cf6",
    "Materials":              "#a3e635",
    "Information Technology": "#3b82f6",
    "Health Care":            "#10b981",
    # Portfolio-specific
    "Fixed Income":           "#fbbf24",
    "Cash & Equivalents":     "#22c55e",
    "Mutual Funds":           "#a78bfa",
    "Other":                  "#6b7280",
}



def send_portfolio_digest() -> None:
    raw = r.get("portfolio:digest:settings")
    if not raw:
        logger.info("digest: no settings stored, skipping")
        return

    data = json.loads(raw)
    if not data.get("digestEnabled", True):
        logger.info("digest: disabled by user, skipping")
        return

    email    = data.get("email", "").strip()
    holdings = data.get("holdings", [])
    token    = data.get("token", "")
    if not email or not holdings:
        logger.info("digest: email or holdings missing, skipping")
        return

    api_key    = os.getenv("SENDGRID_API_KEY", "")
    from_email = os.getenv("DIGEST_FROM_EMAIL", "")
    if not api_key or not from_email:
        logger.warning("digest: SENDGRID_API_KEY or DIGEST_FROM_EMAIL not configured")
        return

    # ── 1. Live quotes ────────────────────────────────────────────────────────
    equity_holdings = [h for h in holdings if not h.get("staticValue")]
    equity_tickers  = list({h["ticker"] for h in equity_holdings})
    raw_quotes = fetch_quotes(equity_tickers + ["USDCAD=X"])
    usdcad = raw_quotes.get("USDCAD=X", {}).get("price", 1.36)

    if not raw_quotes:
        logger.info("digest: no quotes returned, skipping")
        return

    # ── 2. Weekly open prices (authenticated session, same as fetch_quotes) ──
    weekly_open = fetch_week_opens(equity_tickers)

    # ── 3. Sector info (uses same authenticated Yahoo session as quotes) ─────────
    sectors = fetch_sectors(equity_tickers)
    for t, s in sectors.items():
        r.setex(f"sector:{t}", 86400, s)

    # ── 4. Portfolio metrics ──────────────────────────────────────────────────
    total_value = total_cost = total_day_change = total_weekly_change = 0.0
    sector_values: dict[str, float] = {}
    movers: list[tuple[str, float, float]] = []

    def to_cad(amount: float, currency: str) -> float:
        return amount * usdcad if currency == "USD" else amount

    for h in holdings:
        cb_currency  = h.get("costBasisCurrency") or "USD"
        holding_type = h.get("holdingType")

        if h.get("staticValue"):
            value_cad = h["costBasis"] if cb_currency == "CAD" else h["costBasis"] * usdcad
            total_value += value_cad
            total_cost  += value_cad
            sector = ("Fixed Income"    if holding_type == "bond"
                      else "Mutual Funds" if holding_type == "fund"
                      else "Cash & Equivalents")
            sector_values[sector] = sector_values.get(sector, 0) + value_cad
            continue

        q = raw_quotes.get(h["ticker"])
        if not q:
            continue

        stock_currency = q.get("currency", "USD")
        price          = q["price"]
        change_pct     = q.get("change", 0.0)

        # Normalise cost basis into stock currency
        cb_native = h["costBasis"]
        if cb_currency == "CAD" and stock_currency == "USD":
            cb_native = h["costBasis"] / usdcad
        elif cb_currency == "USD" and stock_currency == "CAD":
            cb_native = h["costBasis"] * usdcad

        value_cad      = to_cad(price, stock_currency)     * h["shares"]
        cost_cad       = to_cad(cb_native, stock_currency) * h["shares"]
        day_change_cad = (change_pct / 100.0) * value_cad

        week_price = weekly_open.get(h["ticker"])
        weekly_change_cad = (
            (to_cad(price, stock_currency) - to_cad(week_price, stock_currency)) * h["shares"]
            if week_price else 0.0
        )

        total_value         += value_cad
        total_cost          += cost_cad
        total_day_change    += day_change_cad
        total_weekly_change += weekly_change_cad

        if abs(change_pct) > 0.01:
            movers.append((h["ticker"], change_pct, day_change_cad))

        sector = sectors.get(h["ticker"], "Other")
        sector_values[sector] = sector_values.get(sector, 0) + value_cad

    if total_value == 0:
        logger.info("digest: total_value is 0, skipping")
        return

    total_pnl     = total_value - total_cost
    total_pnl_pct = (total_pnl / total_cost * 100) if total_cost else 0
    prev_value    = total_value - total_day_change
    day_pct       = (total_day_change / prev_value * 100) if prev_value else 0
    weekly_prev   = total_value - total_weekly_change
    weekly_pct    = (total_weekly_change / weekly_prev * 100) if weekly_prev else 0

    movers.sort(key=lambda x: x[1], reverse=True)
    top_gainers = movers[:3]
    top_losers  = sorted(movers, key=lambda x: x[1])[:3]

    # ── 5. Sector allocation (inline HTML bars — no external image dependency) ──
    sorted_sectors = sorted(sector_values.items(), key=lambda x: -x[1])

    def sector_bars() -> str:
        if not sorted_sectors:
            return ""
        max_pct = sorted_sectors[0][1] / total_value * 100
        rows = ""
        for sector, value in sorted_sectors:
            pct = value / total_value * 100
            bar_w = max(4, int(pct / max_pct * 100))
            color = SECTOR_COLORS.get(sector, "#6b7280")
            rows += f"""
            <tr>
              <td style="padding:4px 10px 4px 0;font-size:12px;color:#bbb;white-space:nowrap;width:160px">{sector}</td>
              <td style="padding:4px 6px 4px 0">
                <div style="background:{color};height:10px;width:{bar_w}%;border-radius:2px"></div>
              </td>
              <td style="padding:4px 0;font-size:12px;color:#777;text-align:right;white-space:nowrap;width:40px">{pct:.1f}%</td>
            </tr>"""
        return rows

    # ── 6. HTML helpers ───────────────────────────────────────────────────────
    def clr(n: float) -> str:
        return "#16a34a" if n >= 0 else "#dc2626"

    def arrow(n: float) -> str:
        return "↑" if n >= 0 else "↓"

    def fmt_cad(n: float) -> str:
        sign = "+" if n >= 0 else "-"
        return f"{sign}${abs(n):,.2f}"

    def fmt_pct(n: float) -> str:
        return f"{'+'if n>=0 else ''}{n:.2f}%"

    def mover_rows(items: list) -> str:
        if not items:
            return '<tr><td colspan="3" style="padding:8px;color:#555;font-size:12px;text-align:center">—</td></tr>'
        rows = ""
        for ticker, pct, chg_cad in items:
            c = clr(pct)
            rows += f"""
            <tr style="border-bottom:1px solid #222">
              <td style="padding:6px 10px;color:#ddd;font-size:13px;font-weight:600">{ticker}</td>
              <td style="padding:6px 10px;color:{c};font-size:13px;text-align:right">{fmt_pct(pct)}</td>
              <td style="padding:6px 10px;color:{c};font-size:13px;text-align:right">{fmt_cad(chg_cad)}</td>
            </tr>"""
        return rows

    def stat_box(label: str, dollar: float, pct: float) -> str:
        return f"""
        <td width="33%" style="background:#1e1e1e;border-radius:8px;padding:16px;vertical-align:top">
          <p style="margin:0 0 6px;font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1px">{label}</p>
          <p style="margin:0;font-size:22px;font-weight:700;color:{clr(dollar)}">{arrow(dollar)} ${abs(dollar):,.2f}</p>
          <p style="margin:4px 0 0;font-size:13px;color:{clr(pct)}">{fmt_pct(pct)}</p>
        </td>"""

    # ── 7. Assemble and send ──────────────────────────────────────────────────
    today = datetime.now()
    date_long  = today.strftime(f"%A, %B {today.day}, %Y")  # Friday, June 21, 2026
    date_short = today.strftime(f"%b {today.day}")           # Jun 21

    subject = (
        f"{date_short} | Portfolio ${total_value:,.2f} | "
        f"Daily {fmt_pct(day_pct)} | "
        f"Week {fmt_pct(weekly_pct)}"
    )

    html_body = f"""
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#111;color:#f1f1f1;border-radius:10px">

  <h2 style="margin:0 0 2px;font-size:20px;color:#fff">Alphalytics Portfolio Digest</h2>
  <p style="margin:0 0 20px;font-size:12px;color:#555">{date_long} &middot; All values in CAD</p>

  <!-- Value bar -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1e1e1e;border-radius:8px;margin-bottom:16px">
    <tr>
      <td style="padding:12px 16px;font-size:12px;color:#777;text-transform:uppercase;letter-spacing:1px">Portfolio Value</td>
      <td style="padding:12px 16px;font-size:18px;font-weight:700;text-align:right">${total_value:,.2f}</td>
    </tr>
  </table>

  <!-- Stat boxes -->
  <table width="100%" cellpadding="6" cellspacing="0" style="margin-bottom:20px;border-collapse:separate;border-spacing:8px">
    <tr>
      {stat_box("Total P&amp;L", total_pnl, total_pnl_pct)}
      {stat_box("Today", total_day_change, day_pct)}
      {stat_box("This Week", total_weekly_change, weekly_pct)}
    </tr>
  </table>

  <!-- Sector chart -->
  <p style="margin:0 0 8px;font-size:11px;color:#555;text-transform:uppercase;letter-spacing:1px">Sector Allocation</p>
  <div style="background:#1e1e1e;border-radius:8px;padding:14px 16px;margin-bottom:20px">
    <table width="100%" cellpadding="0" cellspacing="0">
      {sector_bars()}
    </table>
  </div>

  <!-- Movers -->
  <table width="100%" cellpadding="0" cellspacing="0" style="border-spacing:8px;border-collapse:separate;margin-bottom:24px">
    <tr>
      <td width="50%" valign="top" style="padding-right:6px">
        <p style="margin:0 0 6px;font-size:11px;color:#555;text-transform:uppercase;letter-spacing:1px">Top Gainers</p>
        <table width="100%" style="background:#1e1e1e;border-radius:8px;border-collapse:collapse">
          {mover_rows(top_gainers)}
        </table>
      </td>
      <td width="50%" valign="top" style="padding-left:6px">
        <p style="margin:0 0 6px;font-size:11px;color:#555;text-transform:uppercase;letter-spacing:1px">Top Losers</p>
        <table width="100%" style="background:#1e1e1e;border-radius:8px;border-collapse:collapse">
          {mover_rows(top_losers)}
        </table>
      </td>
    </tr>
  </table>

  <a href="https://alphalytics-theta.vercel.app{f'/?restore={token}' if token else ''}"
     style="display:inline-block;padding:10px 22px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600">
    View Portfolio &rarr;
  </a>

  <p style="margin:24px 0 0;font-size:11px;color:#333">
    Alphalytics &middot; prices from Yahoo Finance &middot; not financial advice
  </p>
</div>
"""

    try:
        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail
        msg = Mail(from_email=from_email, to_emails=email, subject=subject, html_content=html_body)
        SendGridAPIClient(api_key).send(msg)
        logger.info("digest: sent to %s — %s", email, subject)
    except Exception:
        logger.exception("digest: SendGrid send failed")
