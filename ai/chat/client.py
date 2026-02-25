"""
Simple Python client for the Flow EVM Blockscout Text-to-SQL service.

Usage:
    from client import FlowEVMQuery

    q = FlowEVMQuery()
    result = q.ask("What are the top 10 WFLOW holders?")
    print(result["sql"])
    print(result["results"])
"""

import json
import os
import urllib.request
import urllib.error


class FlowEVMQuery:
    """Client for the Vanna SQL service."""

    def __init__(self, base_url: str | None = None, api_token: str | None = None):
        self.base_url = (base_url or os.environ.get("VANNA_URL", "http://localhost:8084")).rstrip("/")
        self.api_token = api_token or os.environ.get("VANNA_API_TOKEN", "")

    def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode() if body else None
        headers = {"Content-Type": "application/json"}
        if self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            error_body = e.read().decode()
            raise RuntimeError(f"HTTP {e.code}: {error_body}") from e

    def ask(self, question: str) -> dict:
        """Send a natural language question, get SQL + results back."""
        return self._request("POST", "/ask", {"question": question})

    def generate_sql(self, question: str) -> dict:
        """Generate SQL without executing."""
        return self._request("POST", "/generate-sql", {"question": question})

    def train(self, **kwargs) -> dict:
        """Add training data. Pass question+sql, ddl, or documentation."""
        return self._request("POST", "/train", kwargs)

    def health(self) -> dict:
        """Check service health."""
        return self._request("GET", "/health")


if __name__ == "__main__":
    import sys

    q = FlowEVMQuery()

    if len(sys.argv) > 1:
        question = " ".join(sys.argv[1:])
    else:
        question = "What is the latest block number?"

    print(f"Question: {question}\n")
    try:
        result = q.ask(question)
        print(f"SQL: {result['sql']}\n")
        print(f"Results ({result['row_count']} rows, {result['elapsed_ms']}ms):")
        for row in result["results"]:
            print(f"  {row}")
    except RuntimeError as e:
        print(f"Error: {e}")
