import type { Template, TemplateArg } from '@/lib/templates'

interface TemplatePanelProps {
  templates: Template[]
  activeId: string
  argValues: Record<string, string>
  currentArgs: TemplateArg[]
  isCustom: boolean
  payer: string
  onSelectTemplate: (id: string) => void
  onArgChange: (name: string, value: string) => void
  onPayerChange: (payer: string) => void
}

export function TemplatePanel({ templates, activeId, argValues, currentArgs, isCustom, payer, onSelectTemplate, onArgChange, onPayerChange }: TemplatePanelProps) {
  return (
    <div className="w-[220px] border-r border-zinc-800/40 flex flex-col shrink-0">
      <div className="px-3 py-2 border-b border-zinc-800/60 bg-black/40">
        <span className="text-[10px] text-zinc-500 tracking-wider flex items-center gap-1.5">
          <span className="text-flow-green/60">~</span> TEMPLATES
        </span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {isCustom && (
          <button
            className="w-full text-left px-3 py-2 text-[11px] text-flow-green bg-flow-green/5 border-l-2 border-flow-green"
          >
            ✦ Custom Code
          </button>
        )}
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelectTemplate(t.id)}
            className={`w-full text-left px-3 py-2 text-[11px] transition-colors ${
              t.id === activeId
                ? 'text-flow-green bg-flow-green/5 border-l-2 border-flow-green'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/30 border-l-2 border-transparent'
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* Payer */}
      <div className="border-t border-zinc-800/60 p-3 bg-black/20">
        <div className="text-[10px] text-zinc-500 tracking-wider mb-2 flex items-center gap-1.5">
          <span className="text-flow-green/60">⚡</span> PAYER
        </div>
        <input
          type="text"
          value={payer}
          onChange={(e) => onPayerChange(e.target.value)}
          className="w-full bg-black/40 border border-zinc-800/60 rounded px-2 py-1 text-[10px] text-zinc-400 font-mono focus:border-flow-green focus:shadow-[0_0_8px_rgba(0,239,139,0.15)] focus:outline-none transition-all"
        />
      </div>

      {/* Params */}
      {currentArgs.length > 0 && (
        <div className="border-t border-zinc-800/60 p-3 bg-black/20">
          <div className="text-[10px] text-zinc-500 tracking-wider mb-3 flex items-center gap-1.5">
            <span className="text-flow-green/60">&gt;</span> PARAMS
          </div>
          <div className="space-y-3">
            {currentArgs.map((arg) => (
              <div key={arg.name}>
                <label className="text-[10px] text-zinc-400 block mb-1">{arg.name} <span className="text-zinc-500">({arg.type})</span></label>
                <input
                  type="text"
                  value={argValues[arg.name] ?? arg.defaultValue}
                  onChange={(e) => onArgChange(arg.name, e.target.value)}
                  className="w-full bg-black/40 border border-zinc-800/60 rounded px-2 py-1 text-[11px] text-zinc-300 focus:border-flow-green focus:shadow-[0_0_8px_rgba(0,239,139,0.15)] focus:outline-none transition-all"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
