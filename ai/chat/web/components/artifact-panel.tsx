"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { CopyIcon, DownloadIcon, X } from "lucide-react";

import {
  Artifact,
  ArtifactHeader,
  ArtifactTitle,
  ArtifactActions,
  ArtifactAction,
  ArtifactClose,
  ArtifactContent,
} from "@/components/ai-elements/artifact";
import {
  CodeBlock,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockActions,
  CodeBlockCopyButton,
} from "@/components/ai-elements/code-block";
import { SqlResultTable, type SqlResult } from "./sql-result-table";
import { ChartArtifact, type ChartData } from "./chart-artifact";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArtifactState {
  type: "sql" | "chart" | "cadence";
  title: string;
  data: SqlResult | ChartData | CadenceArtifactData;
}

export interface CadenceArtifactData {
  script: string;
  result?: unknown;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ArtifactPanelContextType {
  artifact: ArtifactState | null;
  openArtifact: (artifact: ArtifactState) => void;
  closeArtifact: () => void;
}

const ArtifactPanelContext = createContext<ArtifactPanelContextType | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ArtifactPanelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [artifact, setArtifact] = useState<ArtifactState | null>(null);

  const openArtifact = useCallback((a: ArtifactState) => {
    setArtifact(a);
  }, []);

  const closeArtifact = useCallback(() => {
    setArtifact(null);
  }, []);

  const value = useMemo(
    () => ({ artifact, openArtifact, closeArtifact }),
    [artifact, openArtifact, closeArtifact]
  );

  return (
    <ArtifactPanelContext.Provider value={value}>
      {children}
    </ArtifactPanelContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useArtifactPanel() {
  const ctx = useContext(ArtifactPanelContext);
  if (!ctx) throw new Error("useArtifactPanel must be used within ArtifactPanelProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Header actions per artifact type
// ---------------------------------------------------------------------------

function SqlHeaderActions({ data }: { data: SqlResult }) {
  const exportCsv = useCallback(() => {
    const header = data.columns.join(",");
    const rows = data.rows.map((row) =>
      data.columns
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
  }, [data]);

  return (
    <ArtifactAction
      tooltip="Export CSV"
      icon={DownloadIcon}
      onClick={exportCsv}
      className="!text-zinc-500 hover:!text-white hover:!bg-white/5 !rounded-none"
    />
  );
}

function CadenceHeaderActions({ data }: { data: CadenceArtifactData }) {
  const copyResult = useCallback(async () => {
    if (data.result === undefined) return;
    await navigator.clipboard.writeText(
      JSON.stringify(data.result, null, 2)
    );
  }, [data.result]);

  if (data.result === undefined) return null;

  return (
    <ArtifactAction
      tooltip="Copy result"
      icon={CopyIcon}
      onClick={copyResult}
      className="!text-zinc-500 hover:!text-white hover:!bg-white/5 !rounded-none"
    />
  );
}

// ---------------------------------------------------------------------------
// Body content per artifact type
// ---------------------------------------------------------------------------

function SqlBody({ data }: { data: SqlResult }) {
  return (
    <ArtifactContent className="!p-0">
      <SqlResultTable result={data} />
    </ArtifactContent>
  );
}

function ChartBody({ data }: { data: ChartData }) {
  return (
    <ArtifactContent className="!bg-black">
      <ChartArtifact data={data} />
    </ArtifactContent>
  );
}

function CadenceBody({ data }: { data: CadenceArtifactData }) {
  return (
    <ArtifactContent className="space-y-6 !p-6 !bg-black">
      <CodeBlock code={data.script} language="swift" className="!rounded-none !border-white/5 !bg-zinc-950">
        <CodeBlockHeader className="!border-b !border-white/5 !px-4 !py-3">
          <CodeBlockTitle className="!text-[10px] !uppercase !tracking-widest !font-bold !text-zinc-500">Cadence Script</CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton className="!text-zinc-500 hover:!text-white !rounded-none" />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>
      {data.result !== undefined && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em] dot-matrix">
            Execution Output
          </p>
          <pre className="rounded-none border border-white/5 bg-zinc-950 p-4 text-[12px] font-mono text-zinc-300 overflow-auto max-h-[400px]">
            {typeof data.result === "string" ? data.result : JSON.stringify(data.result, null, 2)}
          </pre>
        </div>
      )}
    </ArtifactContent>
  );
}

// ---------------------------------------------------------------------------
// Panel component
// ---------------------------------------------------------------------------

export function ArtifactPanel() {
  const { artifact, closeArtifact } = useArtifactPanel();

  return (
    <AnimatePresence mode="wait">
      {artifact && (
        <motion.div
          key="artifact-panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: "50%", opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: "tween", duration: 0.3, ease: "circOut" }}
          className="h-full overflow-hidden border-l border-white/5 bg-black z-30"
        >
          <Artifact className="h-full rounded-none border-0 shadow-none !bg-black">
            <ArtifactHeader className="!h-16 !px-6 !border-b !border-white/5 !bg-zinc-950">
              <ArtifactTitle className="dot-matrix !text-[13px] uppercase tracking-[0.2em] !font-bold text-white">
                {artifact.title}
              </ArtifactTitle>
              <ArtifactActions className="!gap-1">
                {artifact.type === "sql" && (
                  <SqlHeaderActions data={artifact.data as SqlResult} />
                )}
                {artifact.type === "cadence" && (
                  <CadenceHeaderActions
                    data={artifact.data as CadenceArtifactData}
                  />
                )}
                <ArtifactClose 
                  onClick={closeArtifact} 
                  className="!text-zinc-500 hover:!text-white hover:!bg-white/5 !rounded-none !p-1.5"
                >
                  <X size={18} />
                </ArtifactClose>
              </ArtifactActions>
            </ArtifactHeader>
            <div className="flex-1 overflow-auto custom-scrollbar">
              {artifact.type === "sql" && (
                <SqlBody data={artifact.data as SqlResult} />
              )}
              {artifact.type === "chart" && (
                <ChartBody data={artifact.data as ChartData} />
              )}
              {artifact.type === "cadence" && (
                <CadenceBody data={artifact.data as CadenceArtifactData} />
              )}
            </div>
          </Artifact>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
