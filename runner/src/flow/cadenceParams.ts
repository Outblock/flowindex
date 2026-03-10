export interface CadenceParam {
  name: string;
  type: string;
}

export function parseMainParams(code: string): CadenceParam[] {
  // Match `fun main(...)` for scripts, or `transaction(...)` for transactions
  const match =
    code.match(/fun\s+main\s*\(([^)]*)\)/) ||
    code.match(/^\s*transaction\s*\(([^)]*)\)/m);
  if (!match || !match[1].trim()) return [];
  return match[1]
    .split(',')
    .map((param) => {
      const trimmed = param.trim();
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) return { name: trimmed, type: 'String' };
      const name = trimmed.slice(0, colonIdx).trim();
      const type = trimmed.slice(colonIdx + 1).trim();
      return { name, type: type || 'String' };
    })
    .filter((p) => p.name);
}

/**
 * Resolve a primitive type name to the actual fcl.t.X constructor.
 */
function resolvePrimitiveType(t: any, typeName: string): any {
  const map: Record<string, any> = {
    String: t.String,
    Character: t.String,
    Int: t.Int,
    Int8: t.Int8,
    Int16: t.Int16,
    Int32: t.Int32,
    Int64: t.Int64,
    Int128: t.Int128,
    Int256: t.Int256,
    UInt: t.UInt,
    UInt8: t.UInt8,
    UInt16: t.UInt16,
    UInt32: t.UInt32,
    UInt64: t.UInt64,
    UInt128: t.UInt128,
    UInt256: t.UInt256,
    Word8: t.UInt8,
    Word16: t.UInt16,
    Word32: t.UInt32,
    Word64: t.UInt64,
    Fix64: t.Fix64,
    UFix64: t.UFix64,
    Bool: t.Bool,
    Address: t.Address,
    Path: t.Path,
  };
  return map[typeName] || t.String;
}

/**
 * Resolve a full Cadence type string (including Optional, Array, Dictionary)
 * to the actual fcl.t.X constructor.
 */
function resolveType(t: any, cadenceType: string): any {
  const trimmed = cadenceType.trim();

  // Optional: e.g. "UInt32?" → t.Optional(t.UInt32)
  if (trimmed.endsWith('?')) {
    const innerType = trimmed.slice(0, -1);
    return t.Optional(resolveType(t, innerType));
  }

  // Array: e.g. "[UInt64]" → t.Array(t.UInt64)
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const innerType = trimmed.slice(1, -1);
    return t.Array(resolveType(t, innerType));
  }

  // Dictionary: e.g. "{String: UInt64}" → t.Dictionary({key: t.String, value: t.UInt64})
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1);
    const colonIdx = inner.indexOf(':');
    if (colonIdx !== -1) {
      const keyType = inner.slice(0, colonIdx).trim();
      const valueType = inner.slice(colonIdx + 1).trim();
      return t.Dictionary({ key: resolveType(t, keyType), value: resolveType(t, valueType) });
    }
    return t.Dictionary({ key: t.String, value: t.String });
  }

  return resolvePrimitiveType(t, trimmed);
}

/**
 * Coerce a raw string value into the shape FCL expects for a given Cadence type.
 */
export function coerceValue(raw: string, cadenceType: string): any {
  const t = cadenceType.trim();

  // Optional: null for empty, otherwise coerce the inner type
  if (t.endsWith('?')) {
    if (raw === '') return null;
    return coerceValue(raw, t.slice(0, -1));
  }
  if (t === 'Bool') return raw === 'true';
  if (t === 'UFix64' || t === 'Fix64') return raw.includes('.') ? raw : `${raw}.0`;
  if (t.startsWith('[') && t.endsWith(']')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.split(',').map((s) => s.trim());
    }
  }
  return raw;
}

/**
 * Convert a raw user-input string + Cadence type into a JSON-CDC object
 * that the Flow emulator / simulate endpoint accepts.
 *
 * JSON-CDC spec: https://cadence-lang.org/docs/json-cadence-spec
 */
export function toCadenceJsonCdc(raw: string, cadenceType: string): Record<string, unknown> {
  const t = cadenceType.trim();

  // Optional
  if (t.endsWith('?')) {
    if (raw === '') return { type: 'Optional', value: null };
    return { type: 'Optional', value: toCadenceJsonCdc(raw, t.slice(0, -1)) };
  }

  // Array: e.g. [UInt64]
  if (t.startsWith('[') && t.endsWith(']')) {
    const innerType = t.slice(1, -1).trim();
    let items: string[];
    try {
      const parsed = JSON.parse(raw);
      items = Array.isArray(parsed) ? parsed.map(String) : [raw];
    } catch {
      items = raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return { type: 'Array', value: items.map((v) => toCadenceJsonCdc(v, innerType)) };
  }

  // Dictionary: e.g. {String: UInt64}
  if (t.startsWith('{') && t.endsWith('}')) {
    const inner = t.slice(1, -1);
    const colonIdx = inner.indexOf(':');
    const keyType = inner.slice(0, colonIdx).trim();
    const valueType = inner.slice(colonIdx + 1).trim();
    let entries: Array<{ key: string; value: string }>;
    try {
      const parsed = JSON.parse(raw);
      entries = Object.entries(parsed).map(([k, v]) => ({ key: k, value: String(v) }));
    } catch {
      entries = [];
    }
    return {
      type: 'Dictionary',
      value: entries.map((e) => ({
        key: toCadenceJsonCdc(e.key, keyType),
        value: toCadenceJsonCdc(e.value, valueType),
      })),
    };
  }

  // Bool
  if (t === 'Bool') return { type: 'Bool', value: raw === 'true' };

  // Fixed-point: ensure decimal
  if (t === 'UFix64' || t === 'Fix64') {
    return { type: t, value: raw.includes('.') ? raw : `${raw}.0` };
  }

  // Address
  if (t === 'Address') return { type: 'Address', value: raw };

  // Path types
  if (t === 'Path') return { type: 'Path', value: { domain: 'storage', identifier: raw } };

  // All integer types + String + Character
  return { type: t, value: raw };
}

export function buildFclArgs(
  params: CadenceParam[],
  values: Record<string, string>,
) {
  return (arg: any, t: any) => {
    return params.map((p) => {
      const raw = values[p.name] || '';
      const fclType = resolveType(t, p.type);
      const value = coerceValue(raw, p.type);
      return arg(value, fclType);
    });
  };
}
