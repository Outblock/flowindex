"use client";

import { useState } from "react";
import { Download, Search } from "lucide-react";

export interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

export function SqlResultTable({ result }: { result: SqlResult }) {
  const [search, setSearch] = useState("");

  const filteredRows = search
    ? result.rows.filter((row) =>
        Object.values(row).some((v) =>
          String(v).toLowerCase().includes(search.toLowerCase())
        )
      )
    : result.rows;

  const exportCsv = () => {
    const header = result.columns.join(",");
    const rows = filteredRows.map((row) =>
      result.columns
        .map((col) => {
          const val = String(row[col] ?? "");
          return val.includes(",") || val.includes('"')
            ? `"${val.replace(/"/g, '""')}"`
            : val;
        })
        .join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "query-results.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-[var(--bg-element)]/40 border-b border-[var(--border-subtle)]">
        <span className="text-[11px] text-[var(--text-tertiary)] font-medium tabular-nums">
          {filteredRows.length} {filteredRows.length === 1 ? "row" : "rows"}
        </span>

        <div className="flex items-center gap-2">
          <div className="relative group">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-tertiary)] group-focus-within:text-[var(--flow-green)] transition-colors duration-150" />
            <input
              type="text"
              placeholder="Filter..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-28 focus:w-40 pl-7 pr-2 py-1.5 text-[11px] bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-md text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--flow-green)]/40 transition-all duration-200"
            />
          </div>
          <button
            onClick={exportCsv}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-md hover:border-[var(--border-strong)] transition-all duration-150 cursor-pointer"
          >
            <Download size={12} />
            CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto max-h-[400px] scrollbar-thin">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr>
              {result.columns.map((col) => (
                <th
                  key={col}
                  className="px-3.5 py-2.5 text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wide border-b border-[var(--border-subtle)] whitespace-nowrap sticky top-0 bg-[var(--bg-panel)] z-10"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-[var(--border-subtle)]/50 hover:bg-[var(--bg-element)]/30 transition-colors duration-100"
              >
                {result.columns.map((col) => (
                  <td
                    key={col}
                    className="px-3.5 py-2.5 text-[12px] text-[var(--text-secondary)] whitespace-nowrap max-w-[300px] truncate mono-font"
                    title={String(row[col] ?? "")}
                  >
                    {formatValue(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredRows.length === 0 && (
        <div className="py-8 text-center">
          <p className="text-[12px] text-[var(--text-tertiary)]">No matching rows</p>
        </div>
      )}
    </div>
  );
}

function formatValue(val: unknown): string | React.ReactNode {
  if (val === null || val === undefined) {
    return <span className="text-[var(--text-tertiary)]/40 italic">null</span>;
  }
  if (typeof val === "number") return val.toLocaleString();
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "string" && val.startsWith("0x")) {
    return <span className="text-[var(--flow-green)]/70">{val}</span>;
  }
  return String(val);
}
