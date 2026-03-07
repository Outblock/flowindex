/**
 * Convert a Uint8Array to a lowercase hex string.
 */
export const bytesToHex = (b: Uint8Array): string =>
  Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');

/**
 * Convert a hex string (with or without 0x prefix) to a Uint8Array.
 */
export const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.replace(/^0x/, '');
  return new Uint8Array((clean.match(/.{1,2}/g) || []).map(b => parseInt(b, 16)));
};

/**
 * Decode a base64url-encoded string to a Uint8Array.
 */
export function base64UrlToBytes(b64u: string): Uint8Array {
  const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
  const b64 = (b64u + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/**
 * Encode a Uint8Array to a base64url string (no padding).
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
