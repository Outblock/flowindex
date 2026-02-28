/**
 * Normalize a Cadence script: strip comments, collapse whitespace.
 * Mirrors backend/internal/repository/script_normalize.go exactly.
 */
export function normalizeScript(script: string): string {
    let b = '';
    let i = 0;
    let inString = false;
    let stringChar = '';

    while (i < script.length) {
        const ch = script[i];

        if (inString) {
            b += ch;
            if (ch === '\\' && i + 1 < script.length) {
                i++;
                b += script[i];
            } else if (ch === stringChar) {
                inString = false;
            }
            i++;
            continue;
        }

        if (ch === '"') {
            inString = true;
            stringChar = ch;
            b += ch;
            i++;
            continue;
        }

        // Single-line comment
        if (ch === '/' && i + 1 < script.length && script[i + 1] === '/') {
            while (i < script.length && script[i] !== '\n') i++;
            b += ' ';
            continue;
        }

        // Multi-line comment
        if (ch === '/' && i + 1 < script.length && script[i + 1] === '*') {
            i += 2;
            while (i + 1 < script.length && !(script[i] === '*' && script[i + 1] === '/')) i++;
            if (i + 1 < script.length) i += 2;
            b += ' ';
            continue;
        }

        b += ch;
        i++;
    }

    // Collapse whitespace
    let out = '';
    let prevSpace = true;
    for (const c of b) {
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
            if (!prevSpace) { out += ' '; prevSpace = true; }
            continue;
        }
        out += c;
        prevSpace = false;
    }
    return out.replace(/ +$/, '');
}

/** SHA-256 hex digest (async, uses Web Crypto) */
export async function sha256Hex(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Compute normalized script hash (matches backend NormalizedScriptHash) */
export async function normalizedScriptHash(script: string): Promise<string> {
    const normalized = normalizeScript(script);
    if (!normalized) return '';
    return sha256Hex(normalized);
}
