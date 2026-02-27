/**
 * Configuration for the FlowScan Webhooks client.
 */
export interface FlowScanConfig {
  /** Your FlowScan API key (starts with "fs_live_"). */
  apiKey: string;
  /**
   * Base URL of the FlowScan API.
   * Defaults to "https://api.flowscan.io" if not provided.
   */
  baseUrl?: string;
}

/**
 * A registered webhook endpoint that receives event deliveries.
 */
export interface Endpoint {
  id: string;
  user_id: string;
  svix_ep_id: string;
  url: string;
  description?: string;
  is_active: boolean;
  created_at: string;
}

/**
 * A subscription that links an endpoint to a specific event type with
 * optional filter conditions.
 */
export interface Subscription {
  id: string;
  user_id: string;
  endpoint_id: string;
  event_type: WebhookEventType;
  conditions: Record<string, unknown> | null;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * An API key record (the plaintext key is only returned once, at creation).
 */
export interface APIKey {
  id: string;
  user_id: string;
  key_prefix: string;
  name: string;
  is_active: boolean;
  created_at: string;
  last_used?: string;
  /** Only present in the response to a CreateAPIKey call. */
  key?: string;
}

/**
 * A log entry recording a webhook delivery attempt.
 */
export interface DeliveryLog {
  id: string;
  subscription_id?: string;
  endpoint_id?: string;
  event_type: string;
  payload: Record<string, unknown>;
  status_code: number;
  delivered_at: string;
  svix_msg_id?: string;
}

/**
 * All supported webhook event type strings.
 */
export type WebhookEventType =
  | "ft.transfer"
  | "nft.transfer"
  | "transaction.sealed"
  | "block.sealed"
  | "account.created"
  | "account.key.added"
  | "account.key.removed"
  | "account.contract.added"
  | "account.contract.updated"
  | "account.contract.removed";

// ---------- Request / response shapes ----------

export interface ListResponse<T> {
  items: T[];
  count: number;
}

export interface CreateEndpointRequest {
  url: string;
  description?: string;
}

export interface CreateSubscriptionRequest {
  endpoint_id: string;
  event_type: WebhookEventType;
  conditions?: Record<string, unknown>;
}

export interface UpdateSubscriptionRequest {
  conditions?: Record<string, unknown>;
  is_enabled?: boolean;
}

export interface CreateAPIKeyRequest {
  name: string;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
}
