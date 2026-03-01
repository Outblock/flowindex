import type { CadenceParam } from '../flow/cadenceParams';

interface ParamPanelProps {
  params: CadenceParam[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}

function placeholderFor(type: string): string {
  if (type === 'Address') return '0x...';
  if (type === 'Bool') return 'true / false';
  if (type === 'UFix64' || type === 'Fix64') return '0.0';
  if (type.startsWith('Int') || type.startsWith('UInt')) return '0';
  if (type.startsWith('[')) return '["a","b"]';
  if (type.endsWith('?')) return 'optional (leave empty for null)';
  return '';
}

export default function ParamPanel({ params, values, onChange }: ParamPanelProps) {
  if (params.length === 0) return null;

  const handleChange = (name: string, value: string) => {
    onChange({ ...values, [name]: value });
  };

  return (
    <div className="border-t border-zinc-700 bg-zinc-900/80 px-4 py-2 shrink-0">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Parameters</div>
      <div className="flex flex-wrap gap-3">
        {params.map((p) => (
          <div key={p.name} className="flex items-center gap-2">
            <label className="text-xs text-zinc-400 whitespace-nowrap">
              {p.name}
              <span className="text-zinc-600 ml-1">: {p.type}</span>
            </label>
            <input
              type="text"
              value={values[p.name] || ''}
              onChange={(e) => handleChange(p.name, e.target.value)}
              placeholder={placeholderFor(p.type)}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 w-48"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
