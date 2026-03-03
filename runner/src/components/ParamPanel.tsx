import { useState } from 'react';
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

/** Recursively decode a Cadence JSON value ({type, value}) into a plain string */
function decodeCadenceValue(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val !== 'object') return String(val);

  if (val.type !== undefined && val.value !== undefined) {
    if (val.type === 'Optional') return val.value ? decodeCadenceValue(val.value) : '';
    if (val.type === 'Array') {
      const items = val.value.map(decodeCadenceValue);
      return JSON.stringify(items);
    }
    if (val.type === 'Dictionary') {
      const dict: Record<string, any> = {};
      val.value.forEach((item: any) => {
        dict[String(decodeCadenceValue(item.key))] = decodeCadenceValue(item.value);
      });
      return JSON.stringify(dict);
    }
    if (val.type === 'Struct' || val.type === 'Resource' || val.type === 'Event') {
      const obj: Record<string, any> = {};
      val.value?.fields?.forEach((f: any) => {
        obj[f.name] = decodeCadenceValue(f.value);
      });
      return JSON.stringify(obj);
    }
    if (val.type === 'Path') return `${val.value.domain}/${val.value.identifier}`;
    if (val.type === 'Type') return val.value.staticType;
    return String(val.value);
  }

  return JSON.stringify(val);
}

/** Try to parse pasted text as either Cadence JSON or plain JSON array and fill params */
function tryParseJsonIntoValues(
  text: string,
  params: CadenceParam[],
): Record<string, string> | null {
  try {
    const parsed = JSON.parse(text.trim());
    if (!Array.isArray(parsed)) return null;

    const result: Record<string, string> = {};

    for (let i = 0; i < params.length && i < parsed.length; i++) {
      const item = parsed[i];
      if (item !== null && typeof item === 'object' && 'type' in item && 'value' in item) {
        // Cadence JSON format: {type: "String", value: "hello"}
        result[params[i].name] = decodeCadenceValue(item);
      } else {
        // Plain JSON value
        result[params[i].name] = typeof item === 'string' ? item : JSON.stringify(item);
      }
    }

    return result;
  } catch {
    return null;
  }
}

export default function ParamPanel({ params, values, onChange }: ParamPanelProps) {
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [parseError, setParseError] = useState('');

  if (params.length === 0) return null;

  const handleChange = (name: string, value: string) => {
    onChange({ ...values, [name]: value });
  };

  const applyJson = (text: string) => {
    const result = tryParseJsonIntoValues(text, params);
    if (result) {
      onChange({ ...values, ...result });
      setParseError('');
      setJsonMode(false);
      setJsonText('');
    } else {
      setParseError('Invalid JSON — expected an array');
    }
  };

  return (
    <div className="border-t border-zinc-700 bg-zinc-900/80 px-4 py-2 shrink-0">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">Parameters</div>
        <button
          type="button"
          onClick={() => { setJsonMode(!jsonMode); setParseError(''); }}
          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
            jsonMode
              ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
              : 'text-zinc-500 border-zinc-700 hover:text-zinc-300 hover:border-zinc-600'
          }`}
          title="Paste JSON array or Cadence JSON to fill all parameters"
        >
          {jsonMode ? 'Cancel' : 'Paste JSON'}
        </button>
      </div>

      {jsonMode ? (
        <div className="space-y-2">
          <textarea
            value={jsonText}
            onChange={(e) => { setJsonText(e.target.value); setParseError(''); }}
            onPaste={(e) => {
              // Auto-apply on paste
              const pasted = e.clipboardData.getData('text');
              setTimeout(() => applyJson(pasted), 0);
            }}
            placeholder={`Paste JSON array or Cadence JSON, e.g.:\n["0x1234...", "100.0"]  or\n[{"type":"Address","value":"0x1234"},{"type":"UFix64","value":"100.0"}]`}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono resize-none"
            rows={4}
            autoFocus
          />
          {parseError && (
            <div className="text-[10px] text-red-400">{parseError}</div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => applyJson(jsonText)}
              className="text-[10px] px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => { setJsonMode(false); setJsonText(''); setParseError(''); }}
              className="text-[10px] px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-300 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
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
      )}
    </div>
  );
}
