"""
Standalone test runner for the portfolio email digest.

Usage:
    python run_digest.py

Requires:
  - .env.development with SENDGRID_API_KEY and DIGEST_FROM_EMAIL set
  - Redis (local or Railway) with portfolio:digest:settings populated
    → either set REDIS_URL in .env.development to your Railway Redis URL,
      or run /portfolio/sync locally first
"""
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env.development")

import json
from db import r
from email_digest import send_portfolio_digest
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")

raw = r.get("portfolio:digest:settings")
if not raw:
    print("\n[!] No portfolio found in Redis (portfolio:digest:settings is empty).")
    print("    Options:")
    print("    1. Add REDIS_URL=<your railway redis url> to .env.development")
    print("    2. Or POST to /portfolio/sync on your local backend first\n")
    raise SystemExit(1)

data = json.loads(raw)
print(f"\n[+] Found portfolio: {len(data.get('holdings', []))} holdings → {data.get('email')}")
print("[+] Firing digest...\n")

send_portfolio_digest()

print("\n[+] Done — check your inbox.")
