import { resolveApiBaseUrl } from '../api';

import { client as findClient } from './gen/find/client.gen';

let configured = false;
let configuring: Promise<void> | null = null;
let _baseURL = '';

export async function ensureHeyApiConfigured() {
  if (configured) return;
  if (!configuring) {
    configuring = (async () => {
      _baseURL = await resolveApiBaseUrl();
      findClient.setConfig({ baseURL: _baseURL, throwOnError: true, timeout: 8000 });
      configured = true;
    })().finally(() => {
      configuring = null;
    });
  }
  await configuring;
}

/** Simple fetch for /status (base route, not in generated SDK) */
export async function fetchStatus(): Promise<any> {
  await ensureHeyApiConfigured();
  const res = await fetch(`${_baseURL}/status`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}
