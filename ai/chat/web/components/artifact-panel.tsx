"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { CopyIcon, DownloadIcon } from "lucide-react";

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

const ArtifactPanelContext = createContext<ArtifactPanelContextType>({
  artifact: null,
  openArtifact: () => {},
  closeArtifact: () => {},
});

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
  return useContext(ArtifactPanelContext);
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
    />
  );
}

// ---------------------------------------------------------------------------
// Body content per artifact type
// ---------------------------------------------------------------------------

function SqlBody({ data }: { data: SqlResult }) {
  return (
    <ArtifactContent>
      <SqlResultTable result={data} />
    </ArtifactContent>
  );
}

function ChartBody({ data }: { data: ChartData }) {
  return (
    <ArtifactContent>
      <ChartArtifact data={data} />
    </ArtifactContent>
  );
}

function CadenceBody({ data }: { data: CadenceArtifactData }) {
  return (
    <ArtifactContent className="space-y-4">
      <CodeBlock code={data.script} language="swift">
        <CodeBlockHeader>
          <CodeBlockTitle>Cadence Script</CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>
      {data.result !== undefined && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
            Result
          </p>
          <pre className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-element)] p-3 text-xs text-[var(--text-secondary)] overflow-auto max-h-[300px]">
            {JSON.stringify(data.result, null, 2)}
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
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="h-full overflow-hidden border-l border-[var(--border-subtle)] bg-[var(--bg-app)]"
        >
          <Artifact className="h-full rounded-none border-0 shadow-none">
            <ArtifactHeader>
              <ArtifactTitle>{artifact.title}</ArtifactTitle>
              <ArtifactActions>
                {artifact.type === "sql" && (
                  <SqlHeaderActions data={artifact.data as SqlResult} />
                )}
                {artifact.type === "cadence" && (
                  <CadenceHeaderActions
                    data={artifact.data as CadenceArtifactData}
                  />
                )}
                <ArtifactClose onClick={closeArtifact} />
              </ArtifactActions>
            </ArtifactHeader>
            {artifact.type === "sql" && (
              <SqlBody data={artifact.data as SqlResult} />
            )}
            {artifact.type === "chart" && (
              <ChartBody data={artifact.data as ChartData} />
            )}
            {artifact.type === "cadence" && (
              <CadenceBody data={artifact.data as CadenceArtifactData} />
            )}
          </Artifact>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
