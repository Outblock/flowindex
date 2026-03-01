import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { editor } from 'monaco-editor';
import CadenceEditor from './editor/CadenceEditor';
import { useCadenceCheck } from './editor/useCadenceCheck';
import ResultPanel from './components/ResultPanel';
import ParamPanel from './components/ParamPanel';
import WalletButton from './components/WalletButton';
import AIPanel from './components/AIPanel';
import { configureFcl } from './flow/fclConfig';
import { parseMainParams } from './flow/cadenceParams';
import { detectCodeType, executeScript, executeTransaction } from './flow/execute';
import type { ExecutionResult } from './flow/execute';
import type { FlowNetwork } from './flow/networks';
import { Play, Loader2 } from 'lucide-react';

const DEFAULT_CODE = `// Welcome to Cadence Runner
// Press Ctrl/Cmd+Enter to execute

access(all) fun main(): String {
    return "Hello, Flow!"
}
`;

export default function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [network, setNetwork] = useState<FlowNetwork>('mainnet');
  const [results, setResults] = useState<ExecutionResult[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    configureFcl(network);
  }, [network]);

  // Cadence type-checking via backend proxy
  useCadenceCheck(editorRef, code, network);

  const scriptParams = useMemo(() => parseMainParams(code), [code]);
  const codeType = useMemo(() => detectCodeType(code), [code]);

  const handleRun = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setResults([]);

    if (codeType === 'script') {
      const result = await executeScript(code, paramValues);
      setResults([result]);
    } else {
      await executeTransaction(code, paramValues, (result) => {
        setResults((prev) => [...prev, result]);
      });
    }

    setLoading(false);
  }, [code, codeType, paramValues, loading]);

  const handleInsertCode = useCallback((newCode: string) => {
    setCode(newCode);
  }, []);

  return (
    <div className="flex h-full bg-zinc-900 text-zinc-100">
      {/* AI Panel (collapsible left sidebar) */}
      <AIPanel onInsertCode={handleInsertCode} />

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-700 bg-zinc-900/80 backdrop-blur shrink-0">
          <h1 className="text-sm font-semibold tracking-tight">Cadence Runner</h1>
          <div className="flex items-center gap-3">
            <select
              value={network}
              onChange={(e) => setNetwork(e.target.value as FlowNetwork)}
              className="bg-zinc-800 text-zinc-300 text-xs px-2 py-1 rounded border border-zinc-700 focus:outline-none focus:border-zinc-500"
            >
              <option value="mainnet">Mainnet</option>
              <option value="testnet">Testnet</option>
            </select>

            <WalletButton />

            <button
              onClick={handleRun}
              disabled={loading}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:text-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              {codeType === 'script' ? 'Run Script' : 'Send Transaction'}
            </button>
          </div>
        </header>

        {/* Editor */}
        <main className="flex-1 min-h-0">
          <CadenceEditor
            code={code}
            onChange={setCode}
            onRun={handleRun}
            darkMode={true}
            externalEditorRef={editorRef}
          />
        </main>

        {/* Parameters */}
        <ParamPanel
          params={scriptParams}
          values={paramValues}
          onChange={setParamValues}
        />

        {/* Results */}
        <ResultPanel results={results} loading={loading} />
      </div>
    </div>
  );
}
