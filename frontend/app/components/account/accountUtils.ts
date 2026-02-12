import type { FTVaultInfo } from '../../../cadence/cadence.gen';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const normalizeAddress = (value: any): string => {
    if (!value) return '';
    const lower = String(value).toLowerCase();
    return lower.startsWith('0x') ? lower : `0x${lower}`;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const formatShort = (value: any, head = 8, tail = 6): string => {
    if (!value) return 'N/A';
    const normalized = normalizeAddress(value);
    if (normalized.length <= head + tail + 3) return normalized;
    return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`;
};

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const formatStorageBytes = (bytes: any): string => {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n === 0) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
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

/** Extract first logo URL from FTVaultInfo.logos */
export const getTokenLogoURL = (token: FTVaultInfo): string => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/** Resolve IPFS links to gateway */
export const resolveIPFS = (url: string): string => {
    if (!url) return '';
    if (url.startsWith('ipfs://')) {
        return url.replace('ipfs://', 'https://ipfs-gtwy-nft.infura-ipfs.io/ipfs/');
    }
    return url;
};

/** Extract thumbnail URL from NFT display metadata with IPFS resolution */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getNFTThumbnail = (nft: any): string => {
    const display = nft?.display;
    if (!display) return '';

    let url = '';
    const thumbnail = display.thumbnail || display; // sometimes display is the image itself (legacy)

    if (typeof thumbnail === 'string') {
        url = thumbnail;
    } else if (thumbnail?.url) {
        url = thumbnail.url;
    } else if (thumbnail?.cid) {
        url = `https://ipfs-gtwy-nft.infura-ipfs.io/ipfs/${thumbnail.cid}${thumbnail.path ? `/${thumbnail.path}` : ''}`;
    }

    return resolveIPFS(url);
};

export interface NFTMedia {
    type: 'image' | 'video';
    url: string;
    fallbackImage?: string;
}

/** Get best media for NFT (Video if available, else Image) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getNFTMedia = (nft: any, collectionId: string = ''): NFTMedia => {
    const image = getNFTThumbnail(nft);
    const id = nft?.tokenId || nft?.id;

    // Type checking helper
    const isCollection = (suffix: string) => collectionId.endsWith(suffix) || collectionId.includes(suffix);

    // 1. NBA Top Shot Video
    if (isCollection('TopShot') || isCollection('0b2a3299cc857e29.TopShot')) {
        return {
            type: 'video',
            url: `https://assets.nbatopshot.com/media/${id}/video`,
            fallbackImage: image
        };
    }

    // 2. HWGarageCardV2 (Hot Wheels)
    if (isCollection('HWGarageCardV2') || isCollection('d0bcefdf1e67ea85.HWGarageCardV2')) {
        return {
            type: 'video', // User said video = image, likely mp4 in image field
            url: image, // Use the image URL as video source
            fallbackImage: image
        };
    }

    // Default to Image
    return {
        type: 'image',
        url: image
    };
};
