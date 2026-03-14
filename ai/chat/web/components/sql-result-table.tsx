"use client";

import { useState, useCallback } from "react";
import { Download, Search, Table, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

export function SqlResultTable({ result, className }: { result: SqlResult; className?: string }) {
  const [search, setSearch] = useState("");

  const filteredRows = search
    ? result.rows.filter((row) =>
        Object.values(row).some((v) =>
          String(v).toLowerCase().includes(search.toLowerCase())
        )
      )
    : result.rows;

  const exportCsv = useCallback(() => {
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
  }, [result.columns, filteredRows]);

  return (
    <div className={cn("rounded-none border border-white/5 overflow-hidden bg-black", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 bg-zinc-950 border-b border-white/5">
        <div className="flex items-center gap-3">
          <Table size={14} className="text-[var(--nothing-red)] opacity-80" />
          <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.2em] dot-matrix tabular-nums">
            {filteredRows.length} BUFFER_ENTRIES
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative group">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600 group-focus-within:text-[var(--nothing-red)] transition-colors duration-200" />
            <input
              type="text"
              placeholder="SEARCH..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-32 focus:w-48 pl-9 pr-3 py-1.5 text-[10px] uppercase font-mono bg-black border border-white/5 rounded-none text-white placeholder-zinc-700 focus:outline-none focus:border-[var(--nothing-red)]/50 transition-all duration-300"
            />
          </div>
          <button
            onClick={exportCsv}
            className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-white bg-white/[0.02] border border-white/5 rounded-none hover:border-white/20 transition-all duration-200 cursor-pointer"
          >
            <Download size={12} />
            CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto max-h-[500px] custom-scrollbar">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr>
              {result.columns.map((col) => (
                <th
                  key={col}
                  className="px-4 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-widest border-b border-white/5 whitespace-nowrap sticky top-0 bg-zinc-950 z-10"
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
                className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors duration-150"
              >
                {result.columns.map((col) => (
                  <td
                    key={col}
                    className="px-4 py-3 text-[12px] text-zinc-400 whitespace-nowrap max-w-[400px] truncate font-mono tracking-tight"
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
        <div className="py-12 text-center bg-black">
          <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-600 font-bold dot-matrix">Zero Results Detected</p>
        </div>
      )}
    </div>
  );
}

function formatValue(val: unknown): string | React.ReactNode {
  if (val === null || val === undefined) {
    return <span className="text-zinc-700 italic">null</span>;
  }
  if (typeof val === "number") return val.toLocaleString();
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "string" && val.startsWith("0x")) {
    return <span className="text-[var(--nothing-red)]/80">{val}</span>;
  }
  return String(val);
}
