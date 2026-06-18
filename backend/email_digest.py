import os
import json
import logging

from db import r
from screener import _yf_session_and_crumb

logger = logging.getLogger(__name__)


def send_portfolio_digest() -> None:
    """Fetch live quotes for stored holdings and email a brief P&L summary via SendGrid."""
    raw = r.get("portfolio:digest:settings")
    if not raw:
        logger.info("digest: no settings stored, skipping")
        return

    data = json.loads(raw)
    email = data.get("email", "").strip()
    holdings = data.get("holdings", [])

    if not email or not holdings:
        logger.info("digest: email or holdings missing, skipping")
        return

    api_key = os.getenv("SENDGRID_API_KEY", "")
    from_email = os.getenv("DIGEST_FROM_EMAIL", "")
    if not api_key or not from_email:
        logger.warning("digest: SENDGRID_API_KEY or DIGEST_FROM_EMAIL not configured")
        return

    # Fetch live quotes
    tickers = list({h["ticker"] for h in holdings})
    quotes: dict = {}
    try:
        session, crumb = _yf_session_and_crumb()
        resp = session.get(
            "https://query2.finance.yahoo.com/v7/finance/quote",
            params={"symbols": ",".join(tickers), "crumb": crumb, "formatted": "false"},
            headers={"Accept": "application/json"},
            timeout=30,
        )
        if resp.ok:
            for q in (resp.json().get("quoteResponse") or {}).get("result") or []:
                quotes[q["symbol"]] = {
                    "price": float(q.get("regularMarketPrice", 0)),
                    "change_pct": float(q.get("regularMarketChangePercent", 0)),
                }
    except Exception:
        logger.exception("digest: failed to fetch quotes")
        return

    if not quotes:
        logger.info("digest: no quotes returned (market may be closed), skipping send")
        return

    # Compute portfolio value and today's dollar change
    total_value = 0.0
    total_day_change = 0.0
    for h in holdings:
        q = quotes.get(h["ticker"])
        if not q or q["price"] <= 0:
            continue
        value = q["price"] * h["shares"]
        day_change = (q["change_pct"] / 100.0) * value
        total_value += value
        total_day_change += day_change

    if total_value == 0:
        logger.info("digest: total_value is 0, skipping send")
        return

    prev_value = total_value - total_day_change
    day_pct = (total_day_change / prev_value * 100) if prev_value else 0.0

    direction = "UP" if total_day_change >= 0 else "DOWN"
    sign = "+" if total_day_change >= 0 else ""
    color = "#16a34a" if total_day_change >= 0 else "#dc2626"
    arrow = "↑" if total_day_change >= 0 else "↓"

    subject = f"Portfolio {direction} {sign}${abs(total_day_change):,.2f} ({sign}{day_pct:.2f}%) today"

    html_body = f"""
<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0a0a;color:#f1f1f1;border-radius:8px">
  <h2 style="margin:0 0 4px;font-size:18px;color:#f1f1f1">Alphalytics Portfolio Digest</h2>
  <p style="margin:0 0 20px;font-size:12px;color:#888">Market close summary</p>

  <div style="background:#111;border-radius:6px;padding:16px 20px;margin-bottom:16px">
    <p style="margin:0 0 6px;font-size:13px;color:#aaa">Today&apos;s change</p>
    <p style="margin:0;font-size:28px;font-weight:700;color:{color}">
      {arrow} {sign}${abs(total_day_change):,.2f}
      <span style="font-size:18px">({sign}{day_pct:.2f}%)</span>
    </p>
  </div>

  <div style="background:#111;border-radius:6px;padding:16px 20px;margin-bottom:24px">
    <p style="margin:0 0 4px;font-size:13px;color:#aaa">Total portfolio value</p>
    <p style="margin:0;font-size:22px;font-weight:600;color:#f1f1f1">${total_value:,.2f}</p>
  </div>

  <a href="https://alphalytics-theta.vercel.app"
     style="display:inline-block;padding:10px 20px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600">
    View Portfolio &rarr;
  </a>

  <p style="margin:24px 0 0;font-size:11px;color:#555">
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
