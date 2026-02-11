import { resolveApiBaseUrl } from '../api';

import { client as coreClient } from './gen/core/client.gen';
import { client as findClient } from './gen/find/client.gen';

let configured = false;
let configuring: Promise<void> | null = null;

export async function ensureHeyApiConfigured() {
  if (configured) return;
  if (!configuring) {
    configuring = (async () => {
      const baseURL = await resolveApiBaseUrl();
      // Make SDK calls throw on errors so existing try/catch patterns work.
      coreClient.setConfig({ baseURL, throwOnError: true, timeout: 8000 });
      findClient.setConfig({ baseURL, throwOnError: true, timeout: 8000 });
      configured = true;
    })().finally(() => {
      configuring = null;
    });
  }
  await configuring;
}
