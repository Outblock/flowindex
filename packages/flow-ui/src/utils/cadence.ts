/**
 * Cadence value decoding and storage path utilities.
 */

import { normalizeAddress } from './address';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const decodeCadenceValue = (val: any): any => {
    if (val === null || val === undefined) return val;
    if (typeof val !== 'object') return val;

    // JSON-CDC encoded value with {type, value}
    if (val.type !== undefined && val.value !== undefined) {
        const t = val.type;
        const v = val.value;

        if (t === 'Optional') return v ? decodeCadenceValue(v) : null;
        if (t === 'Array') return Array.isArray(v) ? v.map(decodeCadenceValue) : [];
        if (t === 'Dictionary') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const dict: Record<string, any> = {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (v || []).forEach((item: any) => {
                const k = decodeCadenceValue(item.key);
                const dv = decodeCadenceValue(item.value);
                dict[String(k)] = dv;
            });
            return dict;
        }
        if (t === 'Struct' || t === 'Resource' || t === 'Event') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const obj: Record<string, any> = {};
            if (v && typeof v === 'object') {
                const fields = v.fields || v;
                if (Array.isArray(fields)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    fields.forEach((f: any) => {
                        if (f.name !== undefined) obj[f.name] = decodeCadenceValue(f.value);
                    });
                    if (v.id) obj['_type'] = v.id;
                    return obj;
                }
            }
            return v;
        }
        if (t === 'Path') {
            const domain = v?.domain ?? '';
            const identifier = v?.identifier ?? '';
            return domain && identifier ? `/${domain}/${identifier}` : String(v ?? '');
        }
        if (t === 'Type') {
            // staticType can be a complex object; extract typeID if available
            const st = v?.staticType;
            if (st && typeof st === 'object') return st.typeID || st;
            return st ?? v ?? '';
        }
        if (t === 'Address') return normalizeAddress(v);
        if (t === 'Bool') return Boolean(v);
        // Numeric types: Int, UInt, Int8..Int256, UInt8..UInt256, Word8..Word64, Fix64, UFix64
        if (/^U?Int\d*$|^Word\d+$|^U?Fix64$/.test(t)) return v;

        return v;
    }

    // Plain object (not JSON-CDC) — recurse into arrays
    if (Array.isArray(val)) return val.map(decodeCadenceValue);

    return val;
};

/** Safely extract storage path identifier from a StoragePath (may be string or {domain, identifier} object) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getStoragePathId = (sp: any): string => {
    if (typeof sp === 'string') return sp.split('/').pop() || sp;
    if (sp && typeof sp === 'object') return sp.identifier || sp.id || '';
    return String(sp || '');
};

/** Coerce a StoragePath to a display string */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const storagePathStr = (sp: any): string => {
    if (typeof sp === 'string') return sp;
    if (sp && typeof sp === 'object') return `${sp.domain || 'storage'}/${sp.identifier || ''}`;
    return String(sp || '');
};
