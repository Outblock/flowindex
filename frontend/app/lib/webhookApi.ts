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
  key?: string;
  key_prefix?: string;
  is_active?: boolean;
  created_at: string;
}

export type EndpointType = 'webhook' | 'discord' | 'slack' | 'telegram' | 'email';

export interface Endpoint {
  id: string;
  url: string;
  description: string;
  endpoint_type: EndpointType;
  metadata?: Record<string, unknown>;
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

export interface Workflow {
  id: string;
  name: string;
  canvas_json: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DeliveryLog {
  id: string;
  subscription_id: string;
  endpoint_id: string;
  event_type: string;
  status_code: number;
  payload: Record<string, unknown>;
  delivered_at: string;
  svix_msg_id?: string;
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
  const data = await request<{ items: string[]; count: number }>('/event-types');
  return (data.items ?? []).map((name) => ({ id: name, name, description: name }));
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

export async function listAPIKeys(): Promise<APIKey[]> {
  const data = await request<{ items: APIKey[]; count: number }>('/api-keys');
  return data.items ?? [];
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
  const data = await request<{ items: Endpoint[]; count: number }>('/endpoints');
  return data.items ?? [];
}

export async function createEndpoint(
  url: string,
  description: string,
  endpointType?: EndpointType,
  metadata?: Record<string, unknown>,
): Promise<Endpoint> {
  return request<Endpoint>('/endpoints', {
    method: 'POST',
    body: JSON.stringify({
      url,
      description,
      endpoint_type: endpointType,
      metadata: metadata ?? {},
    }),
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
  const data = await request<{ items: Subscription[]; count: number }>('/subscriptions');
  return data.items ?? [];
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
  data: { conditions?: Record<string, unknown> | null; is_enabled?: boolean },
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
  const perPage = params?.per_page ?? 20;
  const page = params?.page ?? 1;
  const offset = (page - 1) * perPage;

  const searchParams = new URLSearchParams();
  searchParams.set('limit', String(perPage));
  if (offset > 0) searchParams.set('offset', String(offset));
  if (params?.event_type) searchParams.set('event_type', params.event_type);

  const qs = searchParams.toString();
  const data = await request<{ items: DeliveryLog[]; count: number }>(`/logs${qs ? `?${qs}` : ''}`);
  return {
    data: data.items ?? [],
    total: data.count ?? 0,
    page,
    per_page: perPage,
  };
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export async function listWorkflows(): Promise<Workflow[]> {
  const data = await request<{ items: Workflow[]; count: number }>('/workflows');
  return data.items ?? [];
}

export async function createWorkflow(name?: string, canvasJSON?: Record<string, unknown>): Promise<Workflow> {
  return request<Workflow>('/workflows', {
    method: 'POST',
    body: JSON.stringify({ name: name ?? 'Untitled Workflow', canvas_json: canvasJSON ?? {} }),
  });
}

export async function getWorkflow(id: string): Promise<Workflow> {
  return request<Workflow>(`/workflows/${encodeURIComponent(id)}`);
}

export async function updateWorkflow(
  id: string,
  data: { name?: string; canvas_json?: Record<string, unknown>; is_active?: boolean },
): Promise<Workflow> {
  return request<Workflow>(`/workflows/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteWorkflow(id: string): Promise<void> {
  return request<void>(`/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function deployWorkflow(id: string): Promise<Workflow> {
  return request<Workflow>(`/workflows/${encodeURIComponent(id)}/deploy`, { method: 'POST' });
}
