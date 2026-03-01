export interface CadenceParam {
  name: string;
  type: string;
}

export function parseMainParams(code: string): CadenceParam[] {
  // Match `fun main(...)` — works for both scripts and transaction prepare blocks
  const match = code.match(/fun\s+main\s*\(([^)]*)\)/);
  if (!match || !match[1].trim()) return [];
  return match[1]
    .split(',')
    .map((param) => {
      const parts = param.trim().split(':').map((s) => s.trim());
      return { name: parts[0], type: parts[1] || 'String' };
    })
    .filter((p) => p.name);
}

/**
 * Map a Cadence type string to the FCL type constructor name.
 */
function fclTypeName(cadenceType: string): string {
  const t = cadenceType.trim();
  if (t.endsWith('?')) return 'Optional';
  if (t.startsWith('[') && t.endsWith(']')) return 'Array';
  if (t.startsWith('{') && t.endsWith('}')) return 'Dictionary';
  return t;
}

/**
 * Resolve a type name string to the actual fcl.t.X constructor.
 */
function resolveType(t: any, typeName: string): any {
  const map: Record<string, any> = {
    String: t.String,
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
    Fix64: t.Fix64,
    UFix64: t.UFix64,
    Bool: t.Bool,
    Address: t.Address,
    Path: t.Path,
    Optional: t.Optional(t.String),
    Array: t.Array(t.String),
  };
  return map[typeName] || t.String;
}

/**
 * Coerce a raw string value into the shape FCL expects for a given Cadence type.
 */
function coerceValue(raw: string, cadenceType: string): any {
  const t = cadenceType.trim();

  if (t.endsWith('?') && raw === '') return null;
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

export function buildFclArgs(
  params: CadenceParam[],
  values: Record<string, string>,
) {
  return (arg: any, t: any) => {
    return params.map((p) => {
      const raw = values[p.name] || '';
      const typeName = fclTypeName(p.type);
      const fclType = resolveType(t, typeName);
      const value = coerceValue(raw, p.type);
      return arg(value, fclType);
    });
  };
}
