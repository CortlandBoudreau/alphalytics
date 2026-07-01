"""
build_fund_holdings.py  —  parse a fund holdings export and emit
fund_holdings/{FUND_CODE}.json used by fund_nav.py for nightly NAV estimation.

Supports two input formats:
  • Capital Group CSV  (CIF840 style) — has "Security Name / Asset Type / Shares" columns
  • Fidelity TSV/text  (FID265 style) — section-based layout, no share counts

Usage:
    # Capital Group
    python build_fund_holdings.py CIF840 holdings.csv \
        --nav-per-unit 18.608 --user-units 787.465 --disclosure-date 2026-03-31

    # Fidelity
    python build_fund_holdings.py FID265 FID265_Holdings.txt \
        --nav-per-unit 147.152 --user-units 377.777 --disclosure-date 2026-03-31

Add --fetch-historical-prices to pull the closing price on the disclosure date
from Yahoo Finance for each mapped equity (stored as disclosed_price in the JSON
so fund_nav.py can compute live/disclosed ratios without needing share counts).

Re-run each quarter when the fund publishes updated holdings.
"""

import argparse
import csv
import json
import os
import re
import sys
import time

# ---------------------------------------------------------------------------
# Combined name → Yahoo Finance ticker map (all funds).
# Prefer NYSE/NASDAQ/ADR listings so fetch_quotes() works without FX math.
# ---------------------------------------------------------------------------
EQUITY_TICKER_MAP: dict[str, str] = {
    # ── CIF840  (Capital Group Global Balanced Fund) ───────────────────────
    "Agnico Eagle Mines, Ltd.":                           "AEM",
    "AIA Group, Ltd.":                                    "AAGIY",  # 1 AAGIY ADS = 2 ordinary HK shares
    "Airbus SE, non-registered shares":                   "EADSY",
    "Alphabet, Inc., Class C":                            "GOOG",
    "Altria Group, Inc.":                                 "MO",
    "American Tower Corp. REIT":                          "AMT",
    "Amgen, Inc.":                                        "AMGN",
    "Aon PLC, Class A":                                   "AON",
    "AstraZeneca PLC":                                    "AZN",
    "BAE Systems PLC":                                    "BAESY",
    "Baker Hughes Co., Class A":                          "BKR",
    "BAWAG Group AG":                                     "BWAGF",
    "Boeing Co. (The)":                                   "BA",
    "Broadcom, Inc.":                                     "AVGO",
    "Brookfield Corp., Class A":                          "BN",
    "Brookfield Infrastructure Partners, LP":             "BIP",
    "Canadian Natural Resources, Ltd.":                   "CNQ",
    "Carlyle Group, Inc. (The)":                          "CG",
    "Cloudflare, Inc., Class A":                          "NET",
    "Costco Wholesale Corp.":                             "COST",
    "Darden Restaurants, Inc.":                           "DRI",
    "Engie SA":                                           "ENGIY",
    "Equatorial SA":                                      "EQTLY",
    "Fifth Third Bancorp":                                "FITB",
    "GE Vernova, Inc.":                                   "GEV",
    "General Electric Co. aka GE Aerospace":              "GE",
    "Gilead Sciences, Inc.":                              "GILD",
    "Goldman Sachs Group, Inc. (The)":                    "GS",
    "Goldman Sachs Group, Inc.":                          "GS",
    "Holcim, Ltd.":                                       "HCMLF",
    "Home Depot, Inc.":                                   "HD",
    "International Business Machines Corp.":              "IBM",
    "Industria de Diseno Textil SA":                      "IDEXY",
    "Johnson Controls International PLC":                 "JCI",
    "JPMorgan Chase & Co.":                               "JPM",
    "Keurig Dr Pepper, Inc.":                             "KDP",
    "KLA Corp.":                                          "KLAC",
    "Medtronic PLC":                                      "MDT",
    "Microsoft Corp.":                                    "MSFT",
    "Mitsubishi Heavy Industries, Ltd.":                  "MHVYF",
    "Mitsui & Co., Ltd.":                                 "MITSY",
    "MS&AD Insurance Group Holdings, Inc.":               "MSADY",
    "National Grid PLC":                                  "NGG",
    "Nestle SA":                                          "NSRGY",
    "NIKE, Inc., Class B":                                "NKE",
    "Nippon Steel Corp.":                                 "NPSCY",
    "Novo Nordisk AS, Class B":                           "NONOF",
    "Novo Nordisk AS, Class B (ADR)":                     "NVO",
    "Obayashi Corp.":                                     "OBYCF",
    "Philip Morris International, Inc.":                  "PM",
    "PKO Bank Polski SA, Class C":                        "PKOBY",
    "Progressive Corp.":                                  "PGR",
    "Restaurant Brands International, Inc.":              "QSR",
    "Rio Tinto PLC":                                      "RIO",
    "Saab AB, Class B":                                   "SAABY",
    "Sanofi":                                             "SNY",
    "Shell PLC":                                          "SHEL",
    "SMC Corp.":                                          "SMCEF",
    "Snam SpA":                                           "SNMRF",
    "SSE PLC":                                            "SSEZF",
    "Starbucks Corp.":                                    "SBUX",
    "Taiwan Semiconductor Manufacturing Co., Ltd.":       "TSM",
    "TE Connectivity PLC":                                "TEL",
    "Cigna Group (The)":                                  "CI",
    "TotalEnergies SE":                                   "TTE",
    "Tourmaline Oil Corp.":                               "TOU.TO",
    "Toyota Motor Corp.":                                 "TM",
    "Union Pacific Corp.":                                "UNP",
    "UnitedHealth Group, Inc.":                           "UNH",
    "Vale SA, ordinary nominative shares":                "VALE",
    "Visa, Inc., Class A":                                "V",

    # ── FID265  (Fidelity Canadian Growth Company Fund) ────────────────────
    # Canadian Equities
    "Canadian Natural Resources":                         "CNQ",
    "Agnico Eagle Mines":                                 "AEM",
    "Royal Bank of Canada":                               "RY",
    "Shopify":                                            "SHOP",
    "Canadian Pacific Kansas City Limited":               "CP",
    "Suncor Energy":                                      "SU",
    "Dollarama":                                          "DOL.TO",
    "Bank of Montreal":                                   "BMO",
    "BOMBARDIER INC CL B SUB VTG":                        "BBD-B.TO",
    "Alimentation Couche-Tard":                           "ATD.TO",
    "TFI International":                                  "TFII",
    "Teck Resources, Cl. B, Sub Vtg":                     "TECK",
    "ARC Resources":                                      "ARX.TO",
    "Cameco":                                             "CCJ",
    "Imperial Oil":                                       "IMO.TO",
    "Ero Copper":                                         "ERO.TO",
    "Stantec":                                            "STN.TO",
    "Lundin Mining":                                      "LUN.TO",
    "G MINING VENTURES CORP":                             "GMIN.TO",
    "LUNDIN GOLD INC":                                    "LUG.TO",
    "Wheaton Precious Metals":                            "WPM",
    "Pembina Pipeline":                                   "PBA",
    "MDA SPACE LTD":                                      "MDA.TO",
    "Intact Financial":                                   "IFC.TO",
    "Hudbay Minerals Inc.":                               "HBM.TO",
    "Finning International":                              "FTT.TO",
    "Loblaw":                                             "L.TO",
    "Tourmaline Oil":                                     "TOU.TO",
    "Toromont Industries":                                "TIH.TO",
    "GROUPE DYNAMITE INC":                                "GRGD.TO",
    "Metro":                                              "MRU.TO",
    "RICHELIEU HARDWARE LTD":                             "RCH.TO",
    "IAMGOLD Corporation":                                "IAG",
    "SOUTH BOW CORP":                                     "SOBO.TO",
    "Aritzia":                                            "ATZ.TO",
    "ALAMOS GOLD INC A":                                  "AGI",
    "RB Global":                                          "RBA",
    "Major Drilling Group International":                 "MDI.TO",
    "TRIPLE FLAG PRECIOUS METALS":                        "TFPM.TO",
    "WEST FRASER TIMBER LTD":                             "WFG",
    "TMX Group":                                          "X.TO",
    "NOVAGOLD RESOURCES INC":                             "NG",
    "Canadian National Railway":                          "CNR.TO",
    "ARTEMIS GOLD INC":                                   "ARTG.TO",
    "Kinross Gold":                                       "KGC",
    "SNOWLINE GOLD CORP":                                 "SGD.V",
    "WONDERFI TECHNOLOGIES INC":                          "WNDR.NE",
    "NGEX MINERALS LTD":                                  "NGEX.TO",
    # Foreign Equities
    "Amazon.com":                                         "AMZN",
    "Taiwan Semiconductor Manufacturing":                 "TSM",
    "Nvidia":                                             "NVDA",
    "Alphabet, Cl. C":                                    "GOOG",
    "SK Hynix":                                           "HXSCL",
    "Micron Technology":                                  "MU",
    "Alphabet, Cl. A":                                    "GOOGL",
    "Roblox Corporation":                                 "RBLX",
    "Intel":                                              "INTC",
    "AppLovin Corporation":                               "APP",
    "First Quantum Minerals":                             "FM.TO",
    "Seagate Technology Holdings":                        "STX",
    "NOKIA CORP SPON ADR":                                "NOK",
    "Arista Networks":                                    "ANET",
    "Western Digital":                                    "WDC",
    "Roche Holding":                                      "RHHBY",
    "Samsung Electronics":                                "SSNLF",
    "SanDisk":                                            "SNDK",
    "British American Tobacco":                           "BTI",
    "Eli Lilly and Company":                              "LLY",
    "LOTTOMATICA GROUP SPA":                              "LOTM.MI",
    "LUMENTUM HOLDINGS INC":                              "LITE",
    "Galaxy Digital":                                     "GLXY.TO",
    "FUTU HOLDINGS LTD ADR":                              "FUTU",
    "COHERENT CORP":                                      "COHR",
    "INSMED INC":                                         "INSM",
    "Gilead Sciences":                                    "GILD",
    "FUJIKURA LTD":                                       "FJKLF",
    "IHI CORPORATION":                                    "IHICF",
    "Komatsu":                                            "KMTUY",
    "10x Genomics":                                       "TXG",
    "SharkNinja":                                         "SN",
    "GIGACLOUD TECHNOLOGY INC":                           "GCT",
    "MONOLITHIC POWER SYS INC":                           "MPWR",
    "PULTEGROUP INC":                                     "PHM",
    "MACOM TECHNOLOGY SOLN HLDS INC":                     "MTSI",
    "MILLROSE PROPERTIES INC":                            "MRP",
    "BRAZE INC":                                          "BRZE",
    "IBIDEN":                                             "IIJIY",
    "DISCO Corporation":                                  "DISCY",
    "KB Home":                                            "KBH",
    "ALLBIRDS INC A":                                     "BIRD",
    "LENNAR CORP CL A":                                   "LEN",
    "MASIMO CORP":                                        "MASI",
    "ONESTREAM INC":                                      "OS",
}

# Asset types treated as static (no live price lookup)
_STATIC_ASSET_TYPES = {"fixed income", "cash", "cash equivalent", "convertible"}


def _clean_value(s: str) -> float:
    return float(re.sub(r"[$,\"\s%]", "", s or "0") or "0")


# ---------------------------------------------------------------------------
# Capital Group CSV parser  (CIF840 format)
# ---------------------------------------------------------------------------
def _parse_capital_group_csv(csv_path: str) -> list[dict]:
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        lines = f.readlines()

    header_idx = next(
        (i for i, l in enumerate(lines) if "Security Name" in l and "Asset Type" in l),
        None,
    )
    if header_idx is None:
        raise ValueError("Could not find 'Security Name' / 'Asset Type' header row")

    holdings = []
    reader = csv.DictReader(lines[header_idx:])
    for row in reader:
        name       = row.get("Security Name", "").strip().strip('"')
        asset_type = row.get("Asset Type", "").strip().strip('"')
        raw_shares = row.get("Shares or Principal Amount", "").strip()
        raw_value  = row.get("Market Value ($)", "").strip()
        raw_pct    = row.get("Percent of Net Assets (%)", "").strip()

        if not name or not asset_type:
            continue

        try:
            shares       = _clean_value(raw_shares)
            market_value = _clean_value(raw_value)
            pct          = float(re.sub(r"[%\s]", "", raw_pct or "0") or "0")
        except ValueError:
            continue

        if market_value <= 0:
            continue

        is_equity = asset_type.strip().lower() == "equity"
        ticker    = EQUITY_TICKER_MAP.get(name) if is_equity else None

        if is_equity and ticker is None:
            print(f"  [WARN] No ticker for equity: {name!r}", file=sys.stderr)

        holdings.append({
            "name":                   name,
            "asset_type":             asset_type,
            "ticker":                 ticker,
            "shares":                 shares,
            "disclosed_market_value": market_value,
            "pct_of_net":             pct,
        })

    return holdings


# ---------------------------------------------------------------------------
# Fidelity TSV/text parser  (FID265 format)
# Section headers are plain-text lines; data rows have "$" values.
# ---------------------------------------------------------------------------
_FIDELITY_SECTION_TO_ASSET_TYPE = {
    "cash & other":        "Cash",
    "canadian equities":   "Equity",
    "foreign equities":    "Equity",
    "convertibles":        "Convertible",
    "fixed income":        "Fixed Income",
    "bonds":               "Fixed Income",
}

def _parse_fidelity_text(txt_path: str) -> list[dict]:
    with open(txt_path, encoding="utf-8-sig") as f:
        raw = f.read()

    holdings     = []
    current_type = "Other"

    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue

        # Skip file-header metadata and column-header row
        if any(kw in line.lower() for kw in ("portfolio holdings", "as at ", "as of ",
                                               "security name", "% of net")):
            continue

        # Skip subtotal / total lines
        if re.search(r"subtotal\s*:", line, re.I) or re.search(r"^total\s*:", line, re.I):
            continue

        # Section header — no "$" present
        if "$" not in line:
            key = line.lower().strip().rstrip(":")
            current_type = _FIDELITY_SECTION_TO_ASSET_TYPE.get(key, current_type)
            continue

        # Data row — split on tab (or two-or-more spaces as fallback)
        parts = re.split(r"\t|  {2,}", line)
        if len(parts) < 2:
            continue

        name      = parts[0].strip().strip('"')
        raw_value = parts[1].strip()
        raw_pct   = parts[2].strip() if len(parts) > 2 else "0"

        try:
            market_value = _clean_value(raw_value)
            pct          = float(re.sub(r"[%\s]", "", raw_pct or "0") or "0")
        except ValueError:
            continue

        # Include negative positions (e.g. short FX forwards) as static
        if market_value == 0:
            continue

        is_equity = current_type == "Equity"
        ticker    = EQUITY_TICKER_MAP.get(name) if is_equity else None

        if is_equity and ticker is None:
            # Only warn for holdings ≥ 0.10% of NAV — tiny private placements are expected
            if abs(pct) >= 0.10:
                print(f"  [WARN] No ticker for equity ({pct:.2f}%): {name!r}", file=sys.stderr)

        holdings.append({
            "name":                   name,
            "asset_type":             current_type,
            "ticker":                 ticker,
            "shares":                 None,       # Fidelity doesn't export share counts
            "disclosed_market_value": market_value,
            "pct_of_net":             pct,
        })

    return holdings


# ---------------------------------------------------------------------------
# Optional: fetch closing price on disclosure date from Yahoo Finance
# (needed for Fidelity format since there are no share counts)
# ---------------------------------------------------------------------------
def _fetch_historical_prices(ticker_list: list[str], date_str: str) -> dict[str, float]:
    """
    Return {ticker: closing_price} for each ticker on date_str (YYYY-MM-DD).
    Requires yfinance.  Runs sequentially to avoid ThreadPoolExecutor issues.
    """
    try:
        import yfinance as yf
    except ImportError:
        print("  [WARN] yfinance not available — skipping historical price fetch", file=sys.stderr)
        return {}

    from datetime import datetime, timedelta
    start = date_str
    end   = (datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=4)).strftime("%Y-%m-%d")

    prices: dict[str, float] = {}
    for t in ticker_list:
        try:
            hist = yf.download(t, start=start, end=end, interval="1d",
                               auto_adjust=True, progress=False)
            if hist.empty:
                # Retry with .TO suffix for Canadian tickers
                to_t = t.replace(".", "-") + ".TO" if not t.endswith(".TO") else None
                if to_t:
                    hist = yf.download(to_t, start=start, end=end, interval="1d",
                                       auto_adjust=True, progress=False)
            if not hist.empty:
                prices[t] = round(float(hist["Close"].to_numpy().flat[0]), 4)
                print(f"    {t:12s}  disclosed price = {prices[t]}", file=sys.stderr)
            else:
                print(f"  [WARN] No history for {t} on {date_str}", file=sys.stderr)
        except Exception as exc:
            print(f"  [WARN] History fetch failed for {t}: {exc}", file=sys.stderr)
        time.sleep(0.15)   # polite rate-limiting

    return prices


# ---------------------------------------------------------------------------
# Detect format
# ---------------------------------------------------------------------------
def _detect_format(path: str) -> str:
    with open(path, encoding="utf-8-sig") as f:
        head = f.read(2000)
    if "Asset Type" in head and "Shares or Principal Amount" in head:
        return "capital_group"
    if "% of net assets" in head.lower() or "Canadian Equities" in head:
        return "fidelity"
    return "capital_group"   # default


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("fund_code")
    parser.add_argument("holdings_path")
    parser.add_argument("--nav-per-unit",  type=float, required=True)
    parser.add_argument("--user-units",    type=float, required=True)
    parser.add_argument("--fund-name",     default="")
    parser.add_argument("--disclosure-date", default="")
    parser.add_argument("--fetch-historical-prices", action="store_true",
                        help="Fetch closing price on disclosure date for each equity "
                             "(required for Fidelity format; optional for Capital Group)")
    parser.add_argument("--out-dir", default=os.path.join(os.path.dirname(__file__), "fund_holdings"))
    args = parser.parse_args()

    fmt = _detect_format(args.holdings_path)
    print(f"Detected format: {fmt}")
    print(f"Parsing {args.holdings_path} ...")

    if fmt == "capital_group":
        holdings = _parse_capital_group_csv(args.holdings_path)
    else:
        holdings = _parse_fidelity_text(args.holdings_path)

    total_disclosed_nav = sum(abs(h["disclosed_market_value"]) for h in holdings)
    equity_holdings     = [h for h in holdings if h["asset_type"] == "Equity" and h["ticker"]]
    equity_value        = sum(h["disclosed_market_value"] for h in equity_holdings if h["disclosed_market_value"] > 0)
    coverage_pct        = round(equity_value / total_disclosed_nav * 100, 1) if total_disclosed_nav else 0

    print(f"  {len(holdings)} holdings, {len(equity_holdings)} equities with tickers "
          f"({coverage_pct}% NAV coverage)")

    # Optional: fetch historical prices on disclosure date
    if args.fetch_historical_prices and args.disclosure_date:
        tickers = list({h["ticker"] for h in equity_holdings})
        print(f"  Fetching historical prices for {len(tickers)} tickers on {args.disclosure_date} ...")
        hist_prices = _fetch_historical_prices(tickers, args.disclosure_date)
        for h in holdings:
            if h["ticker"] and h["ticker"] in hist_prices:
                h["disclosed_price"] = hist_prices[h["ticker"]]
    elif fmt == "capital_group":
        # Capital Group has share counts → compute disclosed_price from market value / shares
        for h in holdings:
            if h["ticker"] and h["shares"] and h["shares"] > 0:
                h["disclosed_price"] = round(h["disclosed_market_value"] / h["shares"], 4)

    out = {
        "fund_code":              args.fund_code,
        "fund_name":              args.fund_name or args.fund_code,
        "disclosure_date":        args.disclosure_date,
        "disclosed_nav_per_unit": args.nav_per_unit,
        "user_units":             args.user_units,
        "total_disclosed_nav":    total_disclosed_nav,
        "equity_coverage_pct":    coverage_pct,
        "holdings":               holdings,
    }

    os.makedirs(args.out_dir, exist_ok=True)
    out_path = os.path.join(args.out_dir, f"{args.fund_code}.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)

    print(f"  Written -> {out_path}")


if __name__ == "__main__":
    main()
