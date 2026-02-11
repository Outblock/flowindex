import type { FTVaultInfo } from '../../../cadence/cadence.gen';

export const normalizeAddress = (value: any): string => {
    if (!value) return '';
    const lower = String(value).toLowerCase();
    return lower.startsWith('0x') ? lower : `0x${lower}`;
};

export const formatShort = (value: any, head = 8, tail = 6): string => {
    if (!value) return 'N/A';
    const normalized = normalizeAddress(value);
    if (normalized.length <= head + tail + 3) return normalized;
    return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`;
};

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
            const dict: Record<string, any> = {};
            (v || []).forEach((item: any) => {
                const k = decodeCadenceValue(item.key);
                const dv = decodeCadenceValue(item.value);
                dict[String(k)] = dv;
            });
            return dict;
        }
        if (t === 'Struct' || t === 'Resource' || t === 'Event') {
            const obj: Record<string, any> = {};
            if (v && typeof v === 'object') {
                const fields = v.fields || v;
                if (Array.isArray(fields)) {
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

export const formatStorageBytes = (bytes: any): string => {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n === 0) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

/** Safely extract storage path identifier from a StoragePath (may be string or {domain, identifier} object) */
export const getStoragePathId = (sp: any): string => {
    if (typeof sp === 'string') return sp.split('/').pop() || sp;
    if (sp && typeof sp === 'object') return sp.identifier || sp.id || '';
    return String(sp || '');
};

/** Coerce a StoragePath to a display string */
export const storagePathStr = (sp: any): string => {
    if (typeof sp === 'string') return sp;
    if (sp && typeof sp === 'object') return `${sp.domain || 'storage'}/${sp.identifier || ''}`;
    return String(sp || '');
};

/** Extract first logo URL from FTVaultInfo.logos */
export const getTokenLogoURL = (token: FTVaultInfo): string => {
    const items = (token as any).logos?.items;
    if (!items || items.length === 0) return '';
    const first = items[0];
    if (!first) return '';
    if (typeof first === 'string') return first;
    if (first.file?.url) return first.file.url;
    if (first.file?.uri) return typeof first.file.uri === 'function' ? first.file.uri() : first.file.uri;
    if (first.url) return first.url;
    return '';
};

/** Extract thumbnail URL from NFT display metadata */
export const getNFTThumbnail = (nft: any): string => {
    const display = nft?.display;
    if (!display) return '';
    const thumbnail = display.thumbnail || display;
    if (typeof thumbnail === 'string') return thumbnail;
    if (thumbnail?.url) return thumbnail.url;
    if (thumbnail?.cid) return `https://ipfs.io/ipfs/${thumbnail.cid}${thumbnail.path ? `/${thumbnail.path}` : ''}`;
    return '';
};
