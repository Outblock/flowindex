#!/usr/bin/env python3
"""
Field-level API audit against our OpenAPI v2 spec (OpenAPI 3.x JSON).

Goal: for every endpoint + every schema-defined field, record whether the live API
returns it, and whether the JSON type matches the spec. This is intentionally
lightweight (no external deps) and focuses on "shape" + a small set of semantic
heuristics (addresses / hashes / RFC3339 timestamps).

Typical usage:
  python3 scripts/audit_api_fields.py \
    --base https://flowscan.up.railway.app/api \
    --spec openapi-v2.json \
    --out-md docs/status/api-field-audit.md \
    --out-json output/api-field-audit.json
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import os
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


DEFAULT_BASE = os.environ.get("FLOWSCAN_API_BASE", "https://flowscan.up.railway.app/api")
DEFAULT_TIMEOUT = 10


FLOW_ADDRESS_RE = re.compile(r"^(0x)?[0-9a-f]{16}$")
FLOW_ID_64_RE = re.compile(r"^[0-9a-f]{64}$")
EVM_HASH_RE = re.compile(r"^(0x)?[0-9a-f]{64}$")
CADENCE_TYPE_RE = re.compile(r"^A\\.[0-9a-f]{16}\\.[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)?$")


def http_json(url: str, timeout: int) -> Tuple[int, Any, int]:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ms = int((time.time() - start) * 1000)
            body = resp.read()
            try:
                return resp.status, json.loads(body), ms
            except Exception:
                return resp.status, body.decode("utf-8", errors="replace"), ms
    except urllib.error.HTTPError as e:
        ms = int((time.time() - start) * 1000)
        body = e.read()
        try:
            return e.code, json.loads(body), ms
        except Exception:
            return e.code, body.decode("utf-8", errors="replace"), ms


def load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _json_pointer_unescape(s: str) -> str:
    return s.replace("~1", "/").replace("~0", "~")


def resolve_ref(spec: Dict[str, Any], ref: str) -> Any:
    if not ref.startswith("#/"):
        raise ValueError(f"only local refs supported, got: {ref}")
    node: Any = spec
    for part in ref[2:].split("/"):
        part = _json_pointer_unescape(part)
        node = node[part]
    return node


def schema_type(schema: Dict[str, Any]) -> str:
    if "type" in schema and isinstance(schema["type"], str):
        return schema["type"]
    if "properties" in schema or "additionalProperties" in schema:
        return "object"
    if "items" in schema:
        return "array"
    if "allOf" in schema:
        # best-effort: many allOfs are used to wrap a ref
        return "object"
    return "unknown"


@dataclass
class ExpectedField:
    path: str
    expected_type: str
    required: bool
    fmt: Optional[str] = None
    description: Optional[str] = None


@dataclass
class ObservedField:
    path: str
    observed_type: str
    sample: Optional[str] = None


def collect_expected_fields(
    spec: Dict[str, Any],
    schema: Dict[str, Any],
    prefix: str,
    required: bool,
    out: Dict[str, ExpectedField],
    open_prefixes: Set[str],
    visited_refs: Set[str],
) -> None:
    if "$ref" in schema:
        ref = schema["$ref"]
        if ref in visited_refs:
            return
        visited_refs.add(ref)
        resolved = resolve_ref(spec, ref)
        collect_expected_fields(spec, resolved, prefix, required, out, open_prefixes, visited_refs)
        return

    if "allOf" in schema and isinstance(schema["allOf"], list):
        for sub in schema["allOf"]:
            if isinstance(sub, dict):
                collect_expected_fields(spec, sub, prefix, required, out, open_prefixes, visited_refs)
        return

    t = schema_type(schema)
    fmt = schema.get("format") if isinstance(schema.get("format"), str) else None
    desc = schema.get("description") if isinstance(schema.get("description"), str) else None

    # Record the current node if it is a named field (non-root).
    if prefix:
        existing = out.get(prefix)
        if existing is None:
            out[prefix] = ExpectedField(path=prefix, expected_type=t, required=required, fmt=fmt, description=desc)
        else:
            # Merge: keep required if any layer requires it, and prefer known type/format.
            merged_type = existing.expected_type if existing.expected_type != "unknown" else t
            merged_fmt = existing.fmt or fmt
            merged_desc = existing.description or desc
            out[prefix] = ExpectedField(
                path=prefix,
                expected_type=merged_type,
                required=existing.required or required,
                fmt=merged_fmt,
                description=merged_desc,
            )

    if t == "object":
        props = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
        req_list = schema.get("required") if isinstance(schema.get("required"), list) else []
        req_set = {x for x in req_list if isinstance(x, str)}

        for name, child in props.items():
            if not isinstance(name, str) or not isinstance(child, dict):
                continue
            child_path = f"{prefix}.{name}" if prefix else name
            collect_expected_fields(spec, child, child_path, name in req_set, out, open_prefixes, visited_refs)

        if "additionalProperties" in schema and schema["additionalProperties"] not in (False, None):
            # Any extra keys are allowed under this prefix, so don't treat them as "extra".
            if prefix:
                open_prefixes.add(prefix)
            ap = schema["additionalProperties"]
            if ap is True:
                return
            if isinstance(ap, dict) and prefix:
                collect_expected_fields(spec, ap, f"{prefix}.*", False, out, open_prefixes, visited_refs)

    if t == "array":
        items = schema.get("items")
        if isinstance(items, dict):
            item_path = f"{prefix}[]" if prefix else "[]"
            collect_expected_fields(spec, items, item_path, False, out, open_prefixes, visited_refs)


def _type_of_value(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, int) and not isinstance(v, bool):
        return "integer"
    if isinstance(v, float):
        return "number"
    if isinstance(v, str):
        return "string"
    if isinstance(v, list):
        return "array"
    if isinstance(v, dict):
        return "object"
    return "unknown"


def _sample_value(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, (bool, int, float)):
        return str(v)
    if isinstance(v, str):
        s = v
        if len(s) > 120:
            s = s[:117] + "..."
        return s
    if isinstance(v, list):
        return f"array(len={len(v)})"
    if isinstance(v, dict):
        keys = list(v.keys())
        keys_s = ",".join(str(k) for k in keys[:8])
        if len(keys) > 8:
            keys_s += ",..."
        return f"object(keys={keys_s})"
    return str(v)


def collect_observed_fields(
    payload: Any,
    prefix: str,
    out: Dict[str, ObservedField],
    array_lengths: Dict[str, int],
) -> None:
    t = _type_of_value(payload)
    if prefix:
        out[prefix] = ObservedField(path=prefix, observed_type=t, sample=_sample_value(payload))

    if isinstance(payload, dict):
        for k, v in payload.items():
            if not isinstance(k, str):
                continue
            child_path = f"{prefix}.{k}" if prefix else k
            collect_observed_fields(v, child_path, out, array_lengths)
    elif isinstance(payload, list):
        if prefix:
            array_lengths[prefix] = len(payload)
        if payload:
            child_path = f"{prefix}[]" if prefix else "[]"
            collect_observed_fields(payload[0], child_path, out, array_lengths)


def is_allowed_extra(path: str, open_prefixes: Set[str]) -> bool:
    for p in open_prefixes:
        if path == p:
            return True
        if path.startswith(p + ".") or path.startswith(p + "[]"):
            return True
    return False


def expected_allows_observed(expected_type: str, observed_type: str) -> bool:
    if expected_type == "unknown":
        return True
    if expected_type == observed_type:
        return True
    # OpenAPI: integer is a subset of number.
    if expected_type == "number" and observed_type == "integer":
        return True
    return False


def find_response_schema(op: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    resp = op.get("responses")
    if not isinstance(resp, dict):
        return None
    key = None
    for k in ("200", "201", "202"):
        if k in resp:
            key = k
            break
    if key is None:
        for k in resp.keys():
            if isinstance(k, str) and k.startswith("2"):
                key = k
                break
    if key is None:
        return None
    r = resp.get(key)
    if not isinstance(r, dict):
        return None
    content = r.get("content")
    if not isinstance(content, dict):
        return None
    if "application/json" in content and isinstance(content["application/json"], dict):
        schema = content["application/json"].get("schema")
        return schema if isinstance(schema, dict) else None
    # fallback: first content
    for _, v in content.items():
        if isinstance(v, dict):
            schema = v.get("schema")
            return schema if isinstance(schema, dict) else None
    return None


def get_parameters(op: Dict[str, Any]) -> List[Dict[str, Any]]:
    params = op.get("parameters")
    if not isinstance(params, list):
        return []
    out = []
    for p in params:
        if isinstance(p, dict):
            out.append(p)
    return out


def seed_values(base: str, timeout: int) -> Dict[str, Optional[str]]:
    def safe_get(path: str) -> Any:
        url = base.rstrip("/") + path
        status, payload, _ = http_json(url, timeout=timeout)
        if status != 200:
            return None
        return payload

    seeds: Dict[str, Optional[str]] = {
        "address": None,
        "height": None,
        "tx_id": None,
        "token": None,
        "nft_type": None,
        "nft_item_id": None,
        "identifier": None,
        "evm_hash": None,
        "evm_token_address": None,
    }

    acc = safe_get("/flow/v1/account?limit=1&offset=0")
    if isinstance(acc, dict):
        items = acc.get("data")
        if isinstance(items, list) and items:
            a0 = items[0]
            if isinstance(a0, dict) and isinstance(a0.get("address"), str):
                seeds["address"] = a0["address"]
            if isinstance(a0, dict) and a0.get("height") is not None:
                seeds["height"] = str(a0.get("height"))

    blk = safe_get("/flow/v1/block?limit=1&offset=0")
    if isinstance(blk, dict):
        items = blk.get("data")
        if isinstance(items, list) and items:
            b0 = items[0]
            if isinstance(b0, dict) and b0.get("height") is not None:
                seeds["height"] = str(b0.get("height"))

    tx = safe_get("/flow/v1/transaction?limit=1&offset=0")
    if isinstance(tx, dict):
        items = tx.get("data")
        if isinstance(items, list) and items:
            t0 = items[0]
            if isinstance(t0, dict) and isinstance(t0.get("id"), str):
                seeds["tx_id"] = t0["id"]

    c = safe_get("/flow/v1/contract?limit=1&offset=0")
    if isinstance(c, dict):
        items = c.get("data")
        if isinstance(items, list) and items:
            c0 = items[0]
            if isinstance(c0, dict) and isinstance(c0.get("identifier"), str):
                seeds["identifier"] = c0["identifier"]

    ft = safe_get("/flow/v1/ft?limit=5&offset=0")
    if isinstance(ft, dict):
        items = ft.get("data")
        if isinstance(items, list):
            for it in items:
                if not isinstance(it, dict):
                    continue
                token = it.get("id")
                if not isinstance(token, str):
                    continue
                # Prefer a token that has holdings so downstream endpoints have data.
                holding = safe_get(f"/flow/v1/ft/{urllib.parse.quote(token, safe='')}/holding?limit=1&offset=0")
                if isinstance(holding, dict) and isinstance(holding.get("data"), list) and holding["data"]:
                    seeds["token"] = token
                    # Also pick a representative address from holdings.
                    h0 = holding["data"][0]
                    if isinstance(h0, dict) and isinstance(h0.get("address"), str):
                        seeds["address"] = h0["address"]
                    break

    nft = safe_get("/flow/v1/nft?limit=5&offset=0")
    if isinstance(nft, dict):
        items = nft.get("data")
        if isinstance(items, list):
            for it in items:
                if not isinstance(it, dict):
                    continue
                nft_type = it.get("id")
                if not isinstance(nft_type, str):
                    continue
                holding = safe_get(f"/flow/v1/nft/{urllib.parse.quote(nft_type, safe='')}/holding?limit=1&offset=0")
                if isinstance(holding, dict) and isinstance(holding.get("data"), list) and holding["data"]:
                    seeds["nft_type"] = nft_type
                    h0 = holding["data"][0]
                    if isinstance(h0, dict) and isinstance(h0.get("owner"), str):
                        seeds["address"] = h0["owner"]
                    break

    evm = safe_get("/flow/v1/evm/transaction?limit=1&offset=0")
    if isinstance(evm, dict):
        items = evm.get("data")
        if isinstance(items, list) and items:
            e0 = items[0]
            if isinstance(e0, dict) and isinstance(e0.get("hash"), str):
                seeds["evm_hash"] = e0["hash"]

    evm_token = safe_get("/flow/v1/evm/token?limit=1&offset=0")
    if isinstance(evm_token, dict):
        items = evm_token.get("data")
        if isinstance(items, list) and items:
            t0 = items[0]
            if isinstance(t0, dict):
                addr = t0.get("address") or t0.get("id")
                if isinstance(addr, str):
                    seeds["evm_token_address"] = addr

    return seeds


def fill_path_params(path: str, seeds: Dict[str, Optional[str]]) -> Tuple[str, bool, Optional[str]]:
    # Find all {param} segments
    params: List[str] = []
    for seg in path.split("/"):
        if seg.startswith("{") and seg.endswith("}"):
            params.append(seg[1:-1])

    if not params:
        return path, True, None

    defaults: Dict[str, Optional[str]] = {
        "address": seeds.get("address"),
        "height": seeds.get("height"),
        "id": seeds.get("tx_id"),
        "transaction_id": seeds.get("tx_id"),
        "token": seeds.get("token"),
        "nft_type": seeds.get("nft_type"),
        "identifier": seeds.get("identifier"),
        "hash": seeds.get("evm_hash"),
        # best-effort fallbacks for endpoints that are currently not implemented
        "epoch": "current",
        "role": "collection",
        "node_id": "0",
        "timescale": "daily",
    }

    filled = path
    for p in params:
        val = defaults.get(p)
        # Context-aware overrides for ambiguous {id}/{address} params.
        if p == "id":
            if "/contract/{identifier}/{id}" in path:
                val = seeds.get("identifier")
            if "/nft/{nft_type}/item/{id}" in path:
                val = seeds.get("nft_item_id")
        if p == "address" and "/flow/v1/evm/token/{address}" in path:
            val = seeds.get("evm_token_address")
        if val is None:
            return path, False, f"missing path param {p}"
        filled = filled.replace("{" + p + "}", urllib.parse.quote(str(val), safe=""))
    return filled, True, None


def build_query(params: List[Dict[str, Any]], seeds: Dict[str, Optional[str]]) -> Tuple[Dict[str, str], List[str]]:
    q: Dict[str, str] = {}
    missing_required: List[str] = []

    for p in params:
        if not isinstance(p.get("in"), str) or p.get("in") != "query":
            continue
        name = p.get("name")
        if not isinstance(name, str):
            continue
        required = bool(p.get("required"))

        schema = p.get("schema") if isinstance(p.get("schema"), dict) else {}
        default = schema.get("default")
        enum = schema.get("enum") if isinstance(schema.get("enum"), list) else None
        typ = schema.get("type") if isinstance(schema.get("type"), str) else "string"

        if name in ("limit",):
            q[name] = "1"
            continue
        if name in ("offset",):
            q[name] = "0"
            continue

        if default is not None:
            q[name] = str(default)
            continue
        if enum:
            first = enum[0]
            q[name] = str(first)
            continue

        # Best-effort for a few known required params.
        if name in ("fromBlock", "toBlock"):
            h = seeds.get("height") or "0"
            q[name] = h
            continue
        if name in ("start_date", "end_date"):
            # Any valid date should satisfy parameter parsing; handlers are currently not implemented anyway.
            q[name] = "2020-01-01"
            continue
        if name in ("direction",):
            q[name] = "in"
            continue
        if name in ("id",):
            q[name] = "0"
            continue

        if required:
            # Provide a sane placeholder so we can at least hit the endpoint and record its shape/status.
            if name in ("from", "to"):
                q[name] = "2020-01-01"
                continue
            if name in ("events",):
                q[name] = "Flow.AccountCreated"
                continue
            if typ == "integer":
                q[name] = "0"
                continue
            if typ == "number":
                q[name] = "0"
                continue
            q[name] = "0"
            continue

        # Optional param: leave unset.

    return q, missing_required


def rfc3339_ok(s: str) -> bool:
    # Python's fromisoformat doesn't accept Z, so normalize.
    try:
        if s.endswith("Z"):
            s2 = s[:-1] + "+00:00"
        else:
            s2 = s
        dt.datetime.fromisoformat(s2)
        return True
    except Exception:
        return False


def semantic_warnings(field: ExpectedField, observed: Optional[ObservedField]) -> List[str]:
    if observed is None:
        return []
    if observed.observed_type != "string":
        return []

    key = field.path.split(".")[-1]
    v = observed.sample or ""
    # sample for strings is truncated, but we only use it for format-ish checks.

    warnings: List[str] = []
    if field.fmt == "date-time" or key in ("timestamp", "created_at", "updated_at", "valid_from", "valid_to"):
        if v and v != "null" and not rfc3339_ok(v):
            warnings.append("timestamp_not_rfc3339")

    if key in ("address", "payer", "proposer", "primaryAddress", "secondaryAddress", "owner"):
        if v and v != "null" and not FLOW_ADDRESS_RE.match(v):
            warnings.append("address_format")

    if key in ("block_id", "collection_id", "transaction_id"):
        if v and v != "null" and not FLOW_ID_64_RE.match(v):
            warnings.append("flow_id_format")

    if key in ("hash", "transaction_hash", "tx_hash", "evm_hash"):
        if v and v != "null" and not EVM_HASH_RE.match(v):
            warnings.append("evm_hash_format")

    if key in ("token", "identifier", "nft_type"):
        # Spec examples are cadence type identifiers; warn when it's not.
        if v and v != "null" and not v.startswith("A."):
            warnings.append("cadence_type_expected")
        if v and v != "null" and v.startswith("A.") and not CADENCE_TYPE_RE.match(v):
            warnings.append("cadence_type_format")

    return warnings


@dataclass
class FieldResult:
    field: str
    expected_type: str
    observed_type: Optional[str]
    status: str
    required: bool
    sample: Optional[str]
    warnings: List[str]


@dataclass
class EndpointResult:
    method: str
    path: str
    url: Optional[str]
    http_status: Optional[int]
    latency_ms: Optional[int]
    skip_reason: Optional[str]
    summary: Dict[str, int]
    field_results: List[FieldResult]
    extra_fields: List[ObservedField]


def audit_endpoint(
    spec: Dict[str, Any],
    base: str,
    path: str,
    op: Dict[str, Any],
    seeds: Dict[str, Optional[str]],
    timeout: int,
) -> EndpointResult:
    method = "GET"

    filled_path, ok, reason = fill_path_params(path, seeds)
    if not ok:
        return EndpointResult(
            method=method,
            path=path,
            url=None,
            http_status=None,
            latency_ms=None,
            skip_reason=reason,
            summary={},
            field_results=[],
            extra_fields=[],
        )

    params = get_parameters(op)
    q, missing_required = build_query(params, seeds)
    if missing_required:
        return EndpointResult(
            method=method,
            path=path,
            url=None,
            http_status=None,
            latency_ms=None,
            skip_reason=f"missing required query params: {', '.join(missing_required)}",
            summary={},
            field_results=[],
            extra_fields=[],
        )

    url = base.rstrip("/") + filled_path
    if q:
        url = url + "?" + urllib.parse.urlencode(q)

    status, payload, latency_ms = http_json(url, timeout=timeout)

    schema = find_response_schema(op) or {}
    expected: Dict[str, ExpectedField] = {}
    open_prefixes: Set[str] = set()
    collect_expected_fields(spec, schema, "", False, expected, open_prefixes, set())
    # Many of our responses intentionally leave _meta and _links untyped.
    open_prefixes.update({"_meta", "_links"})

    observed: Dict[str, ObservedField] = {}
    array_lengths: Dict[str, int] = {}
    if isinstance(payload, (dict, list)):
        collect_observed_fields(payload, "", observed, array_lengths)

    field_results: List[FieldResult] = []
    counts = {"expected": len(expected), "ok": 0, "missing": 0, "null": 0, "type_mismatch": 0, "unverified_empty_array": 0}

    def array_prefix_for(p: str) -> Optional[str]:
        # e.g. data[].foo -> data
        if "[]" not in p:
            return None
        return p.split("[]", 1)[0]

    for fpath, ef in sorted(expected.items(), key=lambda kv: kv[0]):
        obs = observed.get(fpath)
        if obs is None:
            ap = array_prefix_for(fpath)
            if ap and ap in array_lengths and array_lengths[ap] == 0:
                st = "UNVERIFIED_EMPTY_ARRAY"
                counts["unverified_empty_array"] += 1
            else:
                st = "MISSING"
                counts["missing"] += 1
            field_results.append(
                FieldResult(
                    field=fpath,
                    expected_type=ef.expected_type,
                    observed_type=None,
                    status=st,
                    required=ef.required,
                    sample=None,
                    warnings=[],
                )
            )
            continue

        if obs.observed_type == "null":
            st = "NULL"
            counts["null"] += 1
        elif expected_allows_observed(ef.expected_type, obs.observed_type):
            st = "OK"
            counts["ok"] += 1
        else:
            st = "TYPE_MISMATCH"
            counts["type_mismatch"] += 1

        warns = semantic_warnings(ef, obs)
        field_results.append(
            FieldResult(
                field=fpath,
                expected_type=ef.expected_type,
                observed_type=obs.observed_type,
                status=st,
                required=ef.required,
                sample=obs.sample,
                warnings=warns,
            )
        )

    extra: List[ObservedField] = []
    if isinstance(payload, (dict, list)):
        for opath, of in sorted(observed.items(), key=lambda kv: kv[0]):
            if opath in expected:
                continue
            if is_allowed_extra(opath, open_prefixes):
                continue
            extra.append(of)

    summary = counts.copy()
    summary["extra"] = len(extra)
    summary["http_status"] = status

    return EndpointResult(
        method=method,
        path=path,
        url=url,
        http_status=status,
        latency_ms=latency_ms,
        skip_reason=None,
        summary=summary,
        field_results=field_results,
        extra_fields=extra,
    )


def markdown_escape(s: str) -> str:
    return s.replace("|", "\\|")


def generate_markdown(report: Dict[str, Any]) -> str:
    lines: List[str] = []
    lines.append("# API Field Audit (OpenAPI v2 spec)")
    lines.append("")
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    lines.append(f"- Generated: `{now}`")
    lines.append(f"- Base: `{report['base']}`")
    lines.append(f"- Spec: `{report['spec']}`")
    lines.append("")
    lines.append("Legend:")
    lines.append("- `OK`: field exists and JSON type matches (integer allowed where spec says number)")
    lines.append("- `NULL`: field exists but value is null")
    lines.append("- `MISSING`: field absent in observed payload")
    lines.append("- `TYPE_MISMATCH`: field exists but JSON type differs from spec")
    lines.append("- `UNVERIFIED_EMPTY_ARRAY`: field is inside an array item, but the array was empty in sample payload")
    lines.append("")

    seeds = report.get("seeds") or {}
    lines.append("Sample Seeds (for path params):")
    for k in ("address", "height", "tx_id", "token", "nft_type", "nft_item_id", "identifier", "evm_hash", "evm_token_address"):
        v = seeds.get(k)
        if v is None:
            v = "null"
        lines.append(f"- `{k}`: `{v}`")
    lines.append("")

    # Summary table
    eps = report.get("endpoints") or []
    lines.append("## Summary")
    lines.append("")
    lines.append("| Endpoint | HTTP | ms | expected | ok | missing | null | type_mismatch | unverified | extra | skip |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|")
    for ep in eps:
        name = f"{ep['method']} {ep['path']}"
        if ep.get("skip_reason"):
            lines.append(
                f"| `{name}` |  |  |  |  |  |  |  |  |  | `{markdown_escape(ep['skip_reason'])}` |"
            )
            continue
        s = ep["summary"]
        lines.append(
            f"| `{name}` | {s.get('http_status','')} | {ep.get('latency_ms','')} | {s.get('expected',0)} | {s.get('ok',0)} | {s.get('missing',0)} | {s.get('null',0)} | {s.get('type_mismatch',0)} | {s.get('unverified_empty_array',0)} | {s.get('extra',0)} |  |"
        )
    lines.append("")

    lines.append("## Details")
    lines.append("")

    for ep in eps:
        lines.append(f"### `{ep['method']} {ep['path']}`")
        if ep.get("url"):
            lines.append(f"- URL: `{ep['url']}`")
        if ep.get("skip_reason"):
            lines.append(f"- SKIP: `{markdown_escape(ep['skip_reason'])}`")
            lines.append("")
            continue
        lines.append(f"- HTTP: `{ep.get('http_status')}`")
        lines.append(f"- Latency: `{ep.get('latency_ms')}ms`")
        s = ep["summary"]
        lines.append(
            f"- Counts: expected={s.get('expected')} ok={s.get('ok')} missing={s.get('missing')} null={s.get('null')} type_mismatch={s.get('type_mismatch')} unverified={s.get('unverified_empty_array')} extra={s.get('extra')}"
        )

        # Emit warnings summary
        warn_fields = [
            fr
            for fr in ep.get("field_results", [])
            if fr.get("warnings") and isinstance(fr.get("warnings"), list) and fr["warnings"]
        ]
        if warn_fields:
            lines.append("- Semantic warnings:")
            for fr in warn_fields[:25]:
                ws = ",".join(fr["warnings"])
                lines.append(f"  - `{fr['field']}`: `{ws}` (sample=`{markdown_escape(fr.get('sample') or '')}`)")
            if len(warn_fields) > 25:
                lines.append(f"  - (and {len(warn_fields) - 25} more...)")

        lines.append("")
        lines.append("<details><summary>Field-Level Report (expected vs observed)</summary>")
        lines.append("")
        lines.append("| Field | Required | Expected | Observed | Status | Sample | Warnings |")
        lines.append("|---|---:|---|---|---|---|---|")
        for fr in ep.get("field_results", []):
            warnings = ",".join(fr.get("warnings") or [])
            lines.append(
                f"| `{fr['field']}` | {str(bool(fr.get('required'))).lower()} | `{fr.get('expected_type')}` | `{fr.get('observed_type')}` | `{fr.get('status')}` | `{markdown_escape(fr.get('sample') or '')}` | `{markdown_escape(warnings)}` |"
            )
        lines.append("")
        lines.append("</details>")
        lines.append("")

        extra = ep.get("extra_fields") or []
        if extra:
            lines.append("<details><summary>Extra Observed Fields (not in spec)</summary>")
            lines.append("")
            lines.append("| Field | Observed | Sample |")
            lines.append("|---|---|---|")
            for of in extra:
                lines.append(
                    f"| `{of['path']}` | `{of['observed_type']}` | `{markdown_escape(of.get('sample') or '')}` |"
                )
            lines.append("")
            lines.append("</details>")
            lines.append("")

    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE, help="API base URL including /api (default: flowscan.up.railway.app/api)")
    ap.add_argument("--spec", default="openapi-v2.json", help="OpenAPI v2 spec JSON file (default: openapi-v2.json)")
    ap.add_argument("--out-json", default="output/api-field-audit.json", help="Write machine report JSON here")
    ap.add_argument("--out-md", default="docs/status/api-field-audit.md", help="Write markdown report here")
    ap.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="Per-request timeout in seconds")
    ap.add_argument("--concurrency", type=int, default=5, help="Max concurrent requests (default: 5)")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    spec = load_json(args.spec)

    paths = spec.get("paths")
    if not isinstance(paths, dict):
        raise SystemExit("spec.paths missing or invalid")

    seeds = seed_values(base, timeout=args.timeout)

    endpoints: List[Tuple[str, Dict[str, Any]]] = []
    for path, item in paths.items():
        if not isinstance(path, str) or not isinstance(item, dict):
            continue
        op = item.get("get")
        if isinstance(op, dict):
            endpoints.append((path, op))

    results: List[EndpointResult] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as pool:
        future_map = {
            pool.submit(audit_endpoint, spec, base, path, op, seeds, args.timeout): (path, op) for path, op in endpoints
        }
        for fut in concurrent.futures.as_completed(future_map):
            results.append(fut.result())

    # Deterministic order for output.
    results.sort(key=lambda r: r.path)

    report = {
        "base": base,
        "spec": args.spec,
        "timestamp": int(time.time()),
        "seeds": seeds,
        "endpoints": [
            {
                "method": r.method,
                "path": r.path,
                "url": r.url,
                "http_status": r.http_status,
                "latency_ms": r.latency_ms,
                "skip_reason": r.skip_reason,
                "summary": r.summary,
                "field_results": [
                    {
                        "field": fr.field,
                        "required": fr.required,
                        "expected_type": fr.expected_type,
                        "observed_type": fr.observed_type,
                        "status": fr.status,
                        "sample": fr.sample,
                        "warnings": fr.warnings,
                    }
                    for fr in r.field_results
                ],
                "extra_fields": [
                    {"path": of.path, "observed_type": of.observed_type, "sample": of.sample} for of in r.extra_fields
                ],
            }
            for r in results
        ],
    }

    os.makedirs(os.path.dirname(args.out_json), exist_ok=True)
    with open(args.out_json, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    md = generate_markdown(report)
    os.makedirs(os.path.dirname(args.out_md), exist_ok=True)
    with open(args.out_md, "w", encoding="utf-8") as f:
        f.write(md)

    print(f"Wrote {args.out_json}")
    print(f"Wrote {args.out_md}")


if __name__ == "__main__":
    main()
