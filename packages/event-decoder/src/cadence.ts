// ── Cadence payload parsing (mirrors backend parseCadenceEventFields) ──

export function parseCadenceValue(v: any): any {
  if (v == null) return v;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v;

  const typeName = v.type as string | undefined;
  const raw = v.value;

  switch (typeName) {
    case 'Optional':
      return raw == null ? null : parseCadenceValue(raw);
    case 'Address':
    case 'UFix64': case 'UInt64': case 'UInt32': case 'UInt16': case 'UInt8':
    case 'Int': case 'Int64': case 'Int32': case 'Int16': case 'Int8': case 'Fix64':
    case 'String': case 'Bool':
      return raw;
    case 'Array':
      if (Array.isArray(raw)) return raw.map(parseCadenceValue);
      return raw;
    case 'Struct': case 'Resource': case 'Event':
      if (raw && typeof raw === 'object' && Array.isArray(raw.fields)) {
        const out: Record<string, any> = {};
        for (const f of raw.fields) {
          if (f && typeof f === 'object' && f.name) {
            out[f.name] = parseCadenceValue(f.value);
          }
        }
        return out;
      }
      return raw;
    default:
      return raw ?? v;
  }
}

export function parseCadenceEventFields(payload: any): Record<string, any> | null {
  if (!payload || typeof payload !== 'object') return null;

  // Already flattened
  if ('amount' in payload) return payload;

  const val = payload.value;
  if (!val || typeof val !== 'object') return payload;

  const fields = val.fields;
  if (!Array.isArray(fields)) return payload;

  const out: Record<string, any> = {};
  for (const f of fields) {
    if (f && typeof f === 'object' && f.name) {
      out[f.name] = parseCadenceValue(f.value);
    }
  }
  return out;
}

// ── Address helpers ──

export function normalizeFlowAddress(addr: string | null | undefined): string {
  if (!addr || typeof addr !== 'string') return '';
  let s = addr.trim().toLowerCase();
  s = s.replace(/^0x/, '');
  if (!s || !/^[0-9a-f]+$/.test(s)) return '';
  return s;
}

export function extractAddress(v: any): string {
  if (typeof v === 'string') return normalizeFlowAddress(v);
  if (v && typeof v === 'object') {
    if (v.address) return normalizeFlowAddress(String(v.address));
    if (v.type === 'Optional') return extractAddress(v.value);
    if (v.type === 'Address') return normalizeFlowAddress(String(v.value));
    if (v.value != null) {
      if (typeof v.value === 'object') return extractAddress(v.value);
      return normalizeFlowAddress(String(v.value));
    }
  }
  return '';
}

export function extractAddressFromFields(fields: Record<string, any>, ...keys: string[]): string {
  for (const key of keys) {
    if (key in fields) {
      const addr = extractAddress(fields[key]);
      if (addr) return addr;
    }
  }
  return '';
}

export function formatAddr(addr: string): string {
  if (!addr) return '';
  return addr.startsWith('0x') ? addr : '0x' + addr;
}

// ── Event type parsing ──

export function parseContractAddress(eventType: string): string {
  const parts = eventType.split('.');
  if (parts.length >= 3 && parts[0] === 'A') {
    return normalizeFlowAddress(parts[1]);
  }
  return '';
}

export function parseContractName(eventType: string): string {
  const parts = eventType.split('.');
  if (parts.length >= 3 && parts[0] === 'A') {
    return parts[2].trim();
  }
  return '';
}
