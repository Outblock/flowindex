#!/usr/bin/env python3
import json
import sys
from collections import defaultdict
from pathlib import Path


def load(path: Path):
    with path.open() as f:
        return json.load(f)


def op_to_ref(op):
    # OpenAPI v2 uses responses -> schema
    resp = op.get("responses", {}).get("200", {})
    schema = resp.get("schema")
    if not schema:
        return ""
    return schema.get("$ref", "")


def collect_tags(spec):
    tags = defaultdict(int)
    for p, ops in spec.get("paths", {}).items():
        for method, op in ops.items():
            for tag in op.get("tags", []):
                tags[tag] += 1
    return tags


def main():
    root = Path(__file__).resolve().parents[2]
    find_api = load(root / "find-api.json")
    api = load(root / "api.json")

    find_paths = find_api.get("paths", {})
    api_paths = api.get("paths", {})

    find_keys = set(find_paths.keys())
    api_keys = set(api_paths.keys())

    print("# API Coverage Matrix")
    print()
    print(f"- find-api paths: {len(find_keys)}")
    print(f"- api.json paths: {len(api_keys)}")
    print(f"- common paths: {len(find_keys & api_keys)}")
    print(f"- find-only paths: {len(find_keys - api_keys)}")
    print()

    print("## Tags (count by operations)")
    def print_tags(title, tags):
        print()
        print(f"### {title}")
        for k, v in sorted(tags.items(), key=lambda x: (-x[1], x[0])):
            print(f"- {k}: {v}")
    print_tags("find-api", collect_tags(find_api))
    print_tags("api.json", collect_tags(api))

    print()
    print("## Endpoint Matrix")
    print()
    print("| Path | Method | Tag | In v1 | In v2 | Response Schema (find) | Response Schema (api) |")
    print("|---|---|---|---|---|---|---|")

    for path in sorted(find_keys | api_keys):
        find_ops = find_paths.get(path, {})
        api_ops = api_paths.get(path, {})
        methods = sorted(set(find_ops.keys()) | set(api_ops.keys()))
        for method in methods:
            f_op = find_ops.get(method)
            a_op = api_ops.get(method)
            tag = ""
            if f_op and f_op.get("tags"):
                tag = f_op["tags"][0]
            elif a_op and a_op.get("tags"):
                tag = a_op["tags"][0]
            f_ref = op_to_ref(f_op) if f_op else ""
            a_ref = op_to_ref(a_op) if a_op else ""
            print(f"| `{path}` | `{method.upper()}` | {tag} | {'yes' if f_op else 'no'} | {'yes' if a_op else 'no'} | {f_ref} | {a_ref} |")

    print()
    print("## Schema Diff Summary")
    print()
    print("This section lists response schema names that differ between v1 and v2 on shared paths.")
    print()
    print("| Path | Method | find schema | api schema |")
    print("|---|---|---|---|")
    for path in sorted(find_keys & api_keys):
        for method in sorted(set(find_paths[path].keys()) | set(api_paths[path].keys())):
            f_op = find_paths[path].get(method)
            a_op = api_paths[path].get(method)
            if not f_op or not a_op:
                continue
            f_ref = op_to_ref(f_op)
            a_ref = op_to_ref(a_op)
            if f_ref != a_ref:
                print(f"| `{path}` | `{method.upper()}` | {f_ref} | {a_ref} |")


if __name__ == "__main__":
    main()
