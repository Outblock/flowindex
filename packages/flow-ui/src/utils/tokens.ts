/**
 * Token logo and metadata utilities.
 */

/**
 * Minimal type for FT vault info used by getTokenLogoURL.
 * Compatible with the full FTVaultInfo from Cadence codegen.
 */
export interface FTVaultInfoLike {
    logos?: {
        items?: Array<
            | string
            | {
                  file?: { url?: string; uri?: string | (() => string) };
                  url?: string;
              }
        >;
    };
}

/** Extract first logo URL from FTVaultInfo.logos */
export const getTokenLogoURL = (token: FTVaultInfoLike): string => {
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
