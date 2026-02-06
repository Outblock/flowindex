#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

DEFAULT_BASE = os.environ.get("FLOWSCAN_BASE_URL", "https://flowscan.up.railway.app")
DEFAULT_TIMEOUT = 5

ADDRESSES = [
    "0xe467b9dd11fa00df",
    "0xc525077910456643",
    "0x84221fe0294044d7",
]

DEFAULT_SAMPLE_TOKEN = "A.f233dcee88fe0abe.FlowToken"
DEFAULT_SAMPLE_NFT = "A.0x631e88ae7f1d7c20.TopShot"
DEFAULT_SAMPLE_CONTRACT = "A.f233dcee88fe0abe.FlowToken"
DEFAULT_SAMPLE_EVM_HASH = "0x0"


def http_json(url, timeout=DEFAULT_TIMEOUT):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            try:
                return resp.status, json.loads(body)
            except Exception:
                return resp.status, body.decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, body.decode("utf-8", errors="replace")


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_latest_height(base):
    status_url = f"{base}/api/status"
    try:
        _, data = http_json(status_url)
        if isinstance(data, dict):
            return int(data.get("max_height") or data.get("latest_height") or 0)
    except Exception:
        pass
    return 0


def get_sample_tx(base):
    url = f"{base}/api/transactions?limit=1"
    try:
        _, data = http_json(url)
        if isinstance(data, dict) and "items" in data and data["items"]:
            return data["items"][0].get("id")
        if isinstance(data, list) and data:
            return data[0].get("id")
    except Exception:
        pass
    return None


def get_sample_ft(base):
    url = f"{base}/api/v1/flow/v1/ft?limit=1"
    try:
        _, data = http_json(url)
        items = None
        if isinstance(data, dict):
            items = data.get("data") or data.get("items")
        if isinstance(items, list) and items:
            return items[0].get("id") or items[0].get("token")
    except Exception:
        pass
    return None


def get_sample_nft(base):
    url = f"{base}/api/v1/flow/v1/nft?limit=1"
    try:
        _, data = http_json(url)
        items = None
        if isinstance(data, dict):
            items = data.get("data") or data.get("items")
        if isinstance(items, list) and items:
            return items[0].get("id") or items[0].get("nft_type")
    except Exception:
        pass
    return None


def get_sample_contract(base):
    url = f"{base}/api/v1/flow/v1/contract?limit=1"
    try:
        _, data = http_json(url)
        items = None
        if isinstance(data, dict):
            items = data.get("data") or data.get("items")
        if isinstance(items, list) and items:
            return items[0].get("id") or items[0].get("identifier")
    except Exception:
        pass
    return None


def resolve_params(path, base, cache):
    params = {}
    for seg in path.split("/"):
        if seg.startswith("{") and seg.endswith("}"):
            name = seg[1:-1]
            params[name] = None

    if not params:
        return path, True, None

    # Resolve common params
    addr = cache.get("address") or ADDRESSES[0]
    height = cache.get("height") or get_latest_height(base)
    tx_id = cache.get("tx_id") or get_sample_tx(base)
    token = cache.get("token") or get_sample_ft(base)
    nft = cache.get("nft_type") or get_sample_nft(base)
    contract_id = cache.get("identifier") or get_sample_contract(base)

    cache.update({
        "address": addr,
        "height": height,
        "tx_id": tx_id,
        "token": token,
        "nft_type": nft,
        "identifier": contract_id,
    })

    defaults = {
        "address": addr,
        "height": str(height) if height else None,
        "id": tx_id,
        "transaction_id": tx_id,
        "token": token,
        "nft_type": nft,
        "identifier": contract_id,
        "epoch": "current",
        "role": "collection",
        "node_id": "0",
        "timescale": "daily",
        "hash": cache.get("evm_hash"),
    }

    for key in params.keys():
        if key in defaults and defaults[key] is not None:
            params[key] = defaults[key]
        else:
            return path, False, f"missing param {key}"

    # Replace params
    for key, val in params.items():
        path = path.replace("{" + key + "}", urllib.parse.quote(str(val)))

    return path, True, None


def normalize_shape(payload):
    if isinstance(payload, dict):
        if "data" in payload and isinstance(payload["data"], list) and payload["data"]:
            return sorted(payload["data"][0].keys())
        return sorted(payload.keys())
    if isinstance(payload, list) and payload:
        if isinstance(payload[0], dict):
            return sorted(payload[0].keys())
    return []


def maybe_add_query(url, path):
    if "?" in url:
        return url
    list_markers = [
        "/transaction",
        "/transfer",
        "/ft",
        "/nft",
        "/block",
        "/account",
        "/contract",
    ]
    if any(marker in path for marker in list_markers):
        return url + "?limit=1&offset=0"
    return url


def load_paths(spec):
    return spec.get("paths", {})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default=DEFAULT_BASE, help="Base URL (default: flowscan.up.railway.app)")
    parser.add_argument("--v1", default="openapi-v1.json", help="Path to v1 spec")
    parser.add_argument("--v2", default="openapi-v2.json", help="Path to v2 spec")
    parser.add_argument("--method", default="GET", help="HTTP method to test (default: GET)")
    parser.add_argument("--out", default="output/api-compare-report.json", help="Output report file")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="Per-request timeout in seconds")
    parser.add_argument("--mode", choices=["all", "common"], default="all", help="Run all endpoints or only common paths")
    parser.add_argument("--concurrency", type=int, default=5, help="Number of concurrent requests")
    parser.add_argument("--api-prefix", default="/api", help="Frontend API prefix (default: /api). Use '' for direct backend.")
    parser.add_argument("--sample-address", default=ADDRESSES[0], help="Sample address for path params")
    parser.add_argument("--sample-token", default=DEFAULT_SAMPLE_TOKEN, help="Sample token identifier")
    parser.add_argument("--sample-nft", default=DEFAULT_SAMPLE_NFT, help="Sample nft type identifier")
    parser.add_argument("--sample-contract", default=DEFAULT_SAMPLE_CONTRACT, help="Sample contract identifier")
    parser.add_argument("--sample-evm-hash", default=DEFAULT_SAMPLE_EVM_HASH, help="Sample EVM transaction hash")
    args = parser.parse_args()

    base = args.base.rstrip("/")
    method = args.method.upper()
    timeout = args.timeout

    v1 = load_json(args.v1)
    v2 = load_json(args.v2)

    v1_paths = load_paths(v1)
    v2_paths = load_paths(v2)

    report = {
        "base": base,
        "method": method,
        "timestamp": int(time.time()),
        "v1_total": 0,
        "v2_total": 0,
        "common_total": 0,
        "results": [],
        "skipped": [],
    }

    cache = {
        "address": args.sample_address,
        "token": args.sample_token,
        "nft_type": args.sample_nft,
        "identifier": args.sample_contract,
        "evm_hash": args.sample_evm_hash,
    }

    api_prefix = args.api_prefix.rstrip("/")

    def run_path(path, spec_name):
        resolved, ok, reason = resolve_params(path, base, cache)
        if not ok:
            report["skipped"].append({"spec": spec_name, "path": path, "reason": reason})
            return None
        api_root = f"{base}{api_prefix}/api/{spec_name}" if api_prefix else f"{base}/api/{spec_name}"
        url = f"{api_root}{resolved}" if resolved.startswith("/") else f"{api_root}/{resolved}"
        url = maybe_add_query(url, path)
        try:
            status, payload = http_json(url, timeout=timeout)
            return {"status": status, "payload": payload, "url": url}
        except Exception as e:
            return {"status": 0, "payload": str(e), "url": url}

    def paths_for_spec(paths):
        for path, methods in paths.items():
            if method.lower() not in methods:
                continue
            yield path

    v1_list = list(paths_for_spec(v1_paths))
    v2_list = list(paths_for_spec(v2_paths))

    report["v1_total"] = len(v1_list)
    report["v2_total"] = len(v2_list)

    common = sorted(set(v1_list).intersection(set(v2_list)))
    report["common_total"] = len(common)

    if args.mode == "common":
        v1_run = common
        v2_run = common
    else:
        v1_run = sorted(set(v1_list))
        v2_run = sorted(set(v2_list))

    def run_batch(paths, spec_name):
        results = []
        with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as pool:
            future_map = {pool.submit(run_path, path, spec_name): path for path in paths}
            for future in as_completed(future_map):
                path = future_map[future]
                try:
                    result = future.result()
                except Exception as e:
                    result = {"status": 0, "payload": str(e), "url": None}
                results.append({
                    "path": path,
                    "spec": spec_name,
                    "status": result["status"] if result else None,
                    "url": result.get("url") if result else None,
                    "shape": normalize_shape(result["payload"]) if result else [],
                })
        return results

    report["results"].extend(run_batch(v1_run, "v1"))
    report["results"].extend(run_batch(v2_run, "v2"))

    comparisons = []
    v1_map = {(r["path"], r["spec"]): r for r in report["results"] if r["spec"] == "v1"}
    v2_map = {(r["path"], r["spec"]): r for r in report["results"] if r["spec"] == "v2"}

    for path in common:
        r1 = v1_map.get((path, "v1"))
        r2 = v2_map.get((path, "v2"))
        if not r1 or not r2:
            continue
        comparisons.append({
            "path": path,
            "v1_status": r1.get("status"),
            "v2_status": r2.get("status"),
            "status_match": r1.get("status") == r2.get("status"),
            "shape_match": r1.get("shape") == r2.get("shape"),
            "v1_shape": r1.get("shape"),
            "v2_shape": r2.get("shape"),
        })

    report["comparisons"] = comparisons

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(f"Saved report to {args.out}")


if __name__ == "__main__":
    main()
