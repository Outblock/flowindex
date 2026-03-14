import type { AbiParameter } from 'viem';

interface SolidityParamInputProps {
  param: AbiParameter;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

function placeholderForType(type: string): string {
  if (type === 'address') return '0x...';
  if (type === 'bool') return 'true / false';
  if (type === 'string') return 'text';
  if (type.startsWith('uint')) return '0';
  if (type.startsWith('int')) return '0 (can be negative)';
  if (type.startsWith('bytes')) return '0x...';
  if (type.endsWith('[]')) return '["value1","value2"]';
  if (type === 'tuple') return '{"field": "value"}';
  return '';
}

function labelForType(type: string): string {
  if (type === 'address') return 'address';
  if (type === 'bool') return 'bool';
  if (type === 'string') return 'string';
  if (type.startsWith('uint')) return type;
  if (type.startsWith('int')) return type;
  if (type.startsWith('bytes')) return type;
  return type;
}

export default function SolidityParamInput({ param, value, onChange, error }: SolidityParamInputProps) {
  const type = param.type;
  const name = param.name || param.type;

  // Bool: toggle switch
  if (type === 'bool') {
    return (
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-zinc-400 font-mono flex-1">
            {name} <span className="text-zinc-600">({type})</span>
          </label>
          <button
            type="button"
            onClick={() => onChange(value === 'true' ? 'false' : 'true')}
            className={`w-8 h-4 rounded-full transition-colors relative cursor-pointer ${
              value === 'true' ? 'bg-orange-600' : 'bg-zinc-700'
            }`}
          >
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
              value === 'true' ? 'translate-x-4' : 'translate-x-0.5'
            }`} />
          </button>
        </div>
        {error && <div className="text-[10px] text-red-400">{error}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <label className="text-[11px] text-zinc-400 font-mono">
        {name} <span className="text-zinc-600">({labelForType(type)})</span>
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholderForType(type)}
        className={`w-full px-2 py-1 text-xs font-mono rounded border bg-zinc-800 text-zinc-200 outline-none transition-colors
          ${error
            ? 'border-red-500 focus:border-red-400'
            : 'border-zinc-700 focus:border-orange-500'
          }`}
      />
      {error && <div className="text-[10px] text-red-400">{error}</div>}
    </div>
  );
}

/** Parse string input to the correct JS type for viem */
export function parseParamValue(type: string, raw: string): unknown {
  if (type === 'bool') return raw === 'true';
  if (type === 'address') return raw as `0x${string}`;
  if (type.startsWith('uint') || type.startsWith('int')) {
    return BigInt(raw);
  }
  if (type.startsWith('bytes')) {
    return raw.startsWith('0x') ? raw : `0x${raw}`;
  }
  if (type === 'string') return raw;
  // Arrays and tuples: parse as JSON
  if (type.endsWith('[]') || type === 'tuple') {
    return JSON.parse(raw);
  }
  return raw;
}
