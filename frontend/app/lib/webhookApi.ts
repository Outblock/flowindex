// ---------------------------------------------------------------------------
// Webhook Developer Portal API client
// ---------------------------------------------------------------------------

const BASE_URL = `${import.meta.env.VITE_API_URL || '/api'}/v1`;
const STORAGE_KEY = 'flowindex_dev_auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventType {
  id: string;
  name: string;
  description: string;
}

export interface APIKey {
  id: string;
  name: string;
  key: string;
  created_at: string;
}

export interface Endpoint {
  id: string;
  url: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  endpoint_id: string;
  event_type: string;
  conditions: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface DeliveryLog {
  id: string;
  subscription_id: string;
  event_type: string;
  status_code: number;
  request_body: string;
  response_body: string;
  created_at: string;
}

export interface PaginatedLogs {
  data: DeliveryLog[];
  total: number;
  page: number;
  per_page: number;
}

export interface LogQueryParams {
  page?: number;
  per_page?: number;
  event_type?: string;
  status_min?: number;
  status_max?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getToken(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.accessToken ?? null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body?.error || body?.message || `Request failed: ${res.status}`);
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  return res.json();
}

// ---------------------------------------------------------------------------
// Event Types
// ---------------------------------------------------------------------------

export async function listEventTypes(): Promise<EventType[]> {
  return request<EventType[]>('/event-types');
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

export async function listAPIKeys(): Promise<APIKey[]> {
  return request<APIKey[]>('/api-keys');
}

export async function createAPIKey(name: string): Promise<APIKey> {
  return request<APIKey>('/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function deleteAPIKey(id: string): Promise<void> {
  return request<void>(`/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export async function listEndpoints(): Promise<Endpoint[]> {
  return request<Endpoint[]>('/endpoints');
}

export async function createEndpoint(url: string, description: string): Promise<Endpoint> {
  return request<Endpoint>('/endpoints', {
    method: 'POST',
    body: JSON.stringify({ url, description }),
  });
}

export async function updateEndpoint(
  id: string,
  data: Partial<Pick<Endpoint, 'url' | 'description'>>,
): Promise<Endpoint> {
  return request<Endpoint>(`/endpoints/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteEndpoint(id: string): Promise<void> {
  return request<void>(`/endpoints/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export async function listSubscriptions(): Promise<Subscription[]> {
  return request<Subscription[]>('/subscriptions');
}

export async function createSubscription(
  endpointId: string,
  eventType: string,
  conditions?: Record<string, unknown> | null,
): Promise<Subscription> {
  return request<Subscription>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      endpoint_id: endpointId,
      event_type: eventType,
      conditions: conditions ?? null,
    }),
  });
}

export async function updateSubscription(
  id: string,
  data: Partial<Pick<Subscription, 'event_type' | 'conditions'>>,
): Promise<Subscription> {
  return request<Subscription>(`/subscriptions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteSubscription(id: string): Promise<void> {
  return request<void>(`/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Delivery Logs
// ---------------------------------------------------------------------------

export async function listDeliveryLogs(params?: LogQueryParams): Promise<PaginatedLogs> {
  const searchParams = new URLSearchParams();
  if (params?.page != null) searchParams.set('page', String(params.page));
  if (params?.per_page != null) searchParams.set('per_page', String(params.per_page));
  if (params?.event_type) searchParams.set('event_type', params.event_type);
  if (params?.status_min != null) searchParams.set('status_min', String(params.status_min));
  if (params?.status_max != null) searchParams.set('status_max', String(params.status_max));

  const qs = searchParams.toString();
  return request<PaginatedLogs>(`/logs${qs ? `?${qs}` : ''}`);
}
