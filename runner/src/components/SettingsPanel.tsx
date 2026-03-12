import { Sparkles, Cpu, Server, Key as KeyIcon, Loader2, Zap, Shield } from 'lucide-react';
import type { LspMode } from '../editor/useLsp';

interface SettingsPanelProps {
  lspMode: LspMode;
  onLspModeChange: (mode: LspMode) => void;
  activeMode: string | null;
  onOpenKeyManager: () => void;
  showKeyManager: boolean;
  autoSign: boolean;
  onToggleAutoSign: (value: boolean) => void;
  simulateBeforeSend: boolean;
  onToggleSimulate: (value: boolean) => void;
}

export default function SettingsPanel({ lspMode, onLspModeChange, activeMode, onOpenKeyManager, showKeyManager, autoSign, onToggleAutoSign, simulateBeforeSend, onToggleSimulate }: SettingsPanelProps) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* LSP Mode */}
      <div className="border-b border-zinc-800">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Language Server</span>
          {!activeMode && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
          {activeMode && lspMode === 'auto' && (
            <span className="text-[10px] text-zinc-600 ml-auto">→ {activeMode}</span>
          )}
        </div>
        <div className="px-3 pb-3">
          <div className="flex rounded-md overflow-hidden border border-zinc-700 bg-zinc-900">
            {([
              { mode: 'auto' as const, icon: Sparkles, label: 'Auto', color: 'violet', desc: 'Starts on Server for fast, stable startup. Warms WASM in background for manual fallback.' },
              { mode: 'wasm' as const, icon: Cpu, label: 'WASM', color: 'emerald', desc: 'Runs in browser Web Worker — local execution, works offline, larger initial download.' },
              { mode: 'server' as const, icon: Server, label: 'Server', color: 'blue', desc: 'Remote LSP via WebSocket — fastest startup and the most consistent auto-mode behavior.' },
            ]).map(({ mode, icon: Icon, label, color, desc }) => (
              <div key={mode} className="relative flex-1 group">
                <button
                  onClick={() => onLspModeChange(mode)}
                  className={`flex items-center justify-center gap-1 w-full px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    lspMode === mode
                      ? `bg-${color}-500/15 text-${color}-400`
                      : 'text-zinc-500 hover:text-zinc-300'
                  } ${mode !== 'server' ? 'border-r border-zinc-700' : ''}`}
                >
                  <Icon className="w-3 h-3" />
                  {label}
                </button>
                <div className="absolute bottom-full left-0 mb-2 w-48 p-2 bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl text-[10px] leading-relaxed opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                  <div className={`text-${color}-400 font-semibold mb-1`}>{label}</div>
                  <div className="text-zinc-400">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Transaction */}
      <div className="border-b border-zinc-800">
        <div className="px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Transaction</span>
        </div>
        <div className="px-3 pb-3 space-y-1">
          <button
            onClick={() => onToggleAutoSign(!autoSign)}
            className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-zinc-800 rounded transition-colors"
          >
            <div className="flex items-center gap-2">
              <Zap className={`w-3.5 h-3.5 ${autoSign ? 'text-amber-400' : ''}`} />
              <span>Auto Sign</span>
            </div>
            <div
              className={`relative w-7 h-4 rounded-full transition-colors ${
                autoSign ? 'bg-amber-500' : 'bg-zinc-600'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                  autoSign ? 'translate-x-3' : ''
                }`}
              />
            </div>
          </button>
          <button
            onClick={() => onToggleSimulate(!simulateBeforeSend)}
            className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-zinc-800 rounded transition-colors"
          >
            <div className="flex items-center gap-2">
              <Shield className={`w-3.5 h-3.5 ${simulateBeforeSend ? 'text-blue-400' : ''}`} />
              <span>Simulate First</span>
            </div>
            <div
              className={`relative w-7 h-4 rounded-full transition-colors ${
                simulateBeforeSend ? 'bg-blue-500' : 'bg-zinc-600'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                  simulateBeforeSend ? 'translate-x-3' : ''
                }`}
              />
            </div>
          </button>
        </div>
      </div>

      {/* Key Manager */}
      <div className="border-b border-zinc-800">
        <div className="px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Security</span>
        </div>
        <div className="px-3 pb-3">
          <button
            onClick={onOpenKeyManager}
            className={`flex items-center gap-1.5 w-full px-2 py-1.5 text-[11px] rounded transition-colors ${
              showKeyManager ? 'bg-emerald-500/15 text-emerald-400' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            <KeyIcon className="w-3.5 h-3.5" />
            Manage Keys
          </button>
        </div>
      </div>
    </div>
  );
}
