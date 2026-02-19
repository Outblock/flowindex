#!/usr/bin/env python3
"""
Cross-validate Flow chain fee series between:
1) FlowIndex compatibility API: /flowscan/v1/stats?metric=fees
2) DefiLlama public summary API: /summary/fees/flow?dataType=dailyFees

The script writes a CSV with daily values and useful diagnostics:
- our_flow_fee
- llama_fee_value
- implied_price_usd = llama_fee_value / our_flow_fee
- coingecko_price_usd (optional, for sanity check)
- our_fee_usd_estimate = our_flow_fee * coingecko_price_usd
"""

import argparse
import csv
import datetime as dt
import json
import math
import os
import statistics
import urllib.parse
import urllib.request
import urllib.error
from decimal import Decimal, InvalidOperation


def http_get_json(url: str, timeout: int = 30, retries: int = 3):
    req = urllib.request.Request(url, headers={"User-Agent": "flowscan-cross-validate/1.0"})
    last_err = None
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
            if i + 1 < retries:
                continue
            raise
    raise last_err


def to_date(ts: int) -> dt.date:
    return dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc).date()


def parse_decimal(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return None
        return Decimal(str(v))
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            return Decimal(s)
        except InvalidOperation:
            return None
    return None


def fetch_llama_daily_map():
    url = "https://api.llama.fi/summary/fees/flow?dataType=dailyFees"
    payload = http_get_json(url)
    chart = payload.get("totalDataChart", [])
    out = {}
    for row in chart:
        if not isinstance(row, list) or len(row) < 2:
            continue
        ts = int(row[0])
        val = parse_decimal(row[1])
        if val is None:
            continue
        out[to_date(ts)] = val
    return out


def _fetch_our_daily_chunk(base_url: str, start: dt.date, end_exclusive: dt.date):
    params = {
        "metric": "fees",
        "timescale": "daily",
        "from": f"{start.isoformat()}T00:00:00Z",
        "to": f"{end_exclusive.isoformat()}T00:00:00Z",
    }
    url = f"{base_url.rstrip('/')}/flowscan/v1/stats?{urllib.parse.urlencode(params)}"
    payload = http_get_json(url)
    data = payload.get("data", [])
    out = {}
    for row in data:
        if not isinstance(row, dict):
            continue
        t = row.get("time", "")
        if not isinstance(t, str) or not t:
            continue
        day = dt.datetime.fromisoformat(t.replace("Z", "+00:00")).date()
        num = parse_decimal(row.get("number"))
        if num is None:
            continue
        out[day] = num
    return out


def fetch_our_daily_map(base_url: str, start: dt.date, end_exclusive: dt.date):
    out = {}
    cursor = start
    step = dt.timedelta(days=30)
    while cursor < end_exclusive:
        nxt = min(cursor + step, end_exclusive)
        try:
            part = _fetch_our_daily_chunk(base_url, cursor, nxt)
            out.update(part)
        except urllib.error.HTTPError as e:
            # Retry with smaller 7-day windows if a large chunk fails.
            if e.code >= 500 and (nxt - cursor).days > 7:
                small = cursor
                small_step = dt.timedelta(days=7)
                while small < nxt:
                    small_nxt = min(small + small_step, nxt)
                    try:
                        part = _fetch_our_daily_chunk(base_url, small, small_nxt)
                        out.update(part)
                    except urllib.error.HTTPError as e2:
                        if e2.code >= 500:
                            print(f"[warn] skip range {small}..{small_nxt} due to HTTP {e2.code}")
                        else:
                            raise
                    small = small_nxt
            else:
                if e.code >= 500:
                    print(f"[warn] skip range {cursor}..{nxt} due to HTTP {e.code}")
                else:
                    raise
        cursor = nxt
    return out


def fetch_coingecko_daily_price_map(start: dt.date, end_exclusive: dt.date):
    from_ts = int(dt.datetime.combine(start, dt.time.min, tzinfo=dt.timezone.utc).timestamp())
    to_ts = int(dt.datetime.combine(end_exclusive, dt.time.min, tzinfo=dt.timezone.utc).timestamp())
    url = (
        "https://api.coingecko.com/api/v3/coins/flow/market_chart/range"
        f"?vs_currency=usd&from={from_ts}&to={to_ts}"
    )
    payload = http_get_json(url)
    prices = payload.get("prices", [])
    bucket = {}
    for p in prices:
        if not isinstance(p, list) or len(p) < 2:
            continue
        ms = int(p[0])
        price = parse_decimal(p[1])
        if price is None:
            continue
        day = dt.datetime.utcfromtimestamp(ms / 1000).date()
        bucket.setdefault(day, []).append(price)
    out = {}
    for day, vals in bucket.items():
        vals_f = [float(v) for v in vals]
        out[day] = Decimal(str(statistics.mean(vals_f)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="https://flowindex.dev/api")
    ap.add_argument("--output", default="output/flow_fee_cross_validation.csv")
    ap.add_argument("--start-date", default="", help="YYYY-MM-DD (optional; default = llama min date)")
    ap.add_argument("--end-date", default="", help="YYYY-MM-DD exclusive (optional; default = llama max+1 day)")
    args = ap.parse_args()

    llama = fetch_llama_daily_map()
    if not llama:
        raise SystemExit("No llama daily data fetched.")

    llama_min = min(llama.keys())
    llama_max = max(llama.keys())
    start = dt.date.fromisoformat(args.start_date) if args.start_date else llama_min
    end_exclusive = dt.date.fromisoformat(args.end_date) if args.end_date else (llama_max + dt.timedelta(days=1))
    if end_exclusive <= start:
        raise SystemExit("end-date must be after start-date")

    our = fetch_our_daily_map(args.base_url, start, end_exclusive)
    cg = fetch_coingecko_daily_price_map(start, end_exclusive)

    dates = sorted(set(d for d in llama.keys() if start <= d < end_exclusive) | set(our.keys()))
    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)

    implied_prices = []
    with open(args.output, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "date",
                "our_flow_fee",
                "llama_fee_value",
                "implied_price_usd",
                "coingecko_price_usd",
                "our_fee_usd_estimate",
                "delta_llama_minus_our_usd_estimate",
            ]
        )
        for d in dates:
            our_fee = our.get(d)
            llama_fee = llama.get(d)
            price = cg.get(d)

            implied = None
            if our_fee is not None and llama_fee is not None and our_fee > 0:
                implied = llama_fee / our_fee
                implied_prices.append(float(implied))

            our_usd = (our_fee * price) if (our_fee is not None and price is not None) else None
            delta = (llama_fee - our_usd) if (llama_fee is not None and our_usd is not None) else None

            w.writerow(
                [
                    d.isoformat(),
                    str(our_fee) if our_fee is not None else "",
                    str(llama_fee) if llama_fee is not None else "",
                    str(implied) if implied is not None else "",
                    str(price) if price is not None else "",
                    str(our_usd) if our_usd is not None else "",
                    str(delta) if delta is not None else "",
                ]
            )

    overlap = sum(1 for d in dates if d in our and d in llama)
    print(f"wrote: {args.output}")
    print(f"date range: {start.isoformat()} .. {(end_exclusive - dt.timedelta(days=1)).isoformat()}")
    print(f"rows: {len(dates)}, overlap_rows: {overlap}")
    if implied_prices:
        print(f"implied_price_usd median={statistics.median(implied_prices):.6f}, mean={statistics.mean(implied_prices):.6f}")
        print("If implied price is close to FLOW/USD market price, llama series is likely USD-valued.")


if __name__ == "__main__":
    main()
