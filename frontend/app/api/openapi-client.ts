import createClient from 'openapi-fetch';
import type { paths } from './openapi';
import { resolveApiBaseUrl } from '../api';

let clientPromise: Promise<ReturnType<typeof createClient<paths>>> | null = null;

export function getOpenApiClient() {
  if (!clientPromise) {
    clientPromise = resolveApiBaseUrl().then((baseUrl) => createClient<paths>({ baseUrl }));
  }
  return clientPromise;
}
