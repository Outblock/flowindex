import type {
  FlowScanConfig,
  Endpoint,
  Subscription,
  APIKey,
  DeliveryLog,
  WebhookEventType,
  ListResponse,
  CreateEndpointRequest,
  CreateSubscriptionRequest,
  UpdateSubscriptionRequest,
  CreateAPIKeyRequest,
  ListOptions,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.flowscan.io";

/**
 * FlowScanError is thrown whenever the API returns a non-2xx response or
 * the response body cannot be parsed as JSON.
 */
export class FlowScanError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "FlowScanError";
  }
}

// ---------- Internal helper ----------

async function request<T>(
  baseUrl: string,
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string | number | undefined>
): Promise<T> {
  const url = new URL(`${baseUrl}${path}`);

  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const init: RequestInit = {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };

  const res = await fetch(url.toString(), init);

  if (res.status === 204) {
    return undefined as unknown as T;
  }

  let data: unknown;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as Record<string, unknown>).error === "string"
        ? (data as Record<string, unknown>).error as string
        : `FlowScan API error: ${res.status} ${res.statusText}`;

    throw new FlowScanError(message, res.status, data);
  }

  return data as T;
}

// ---------- Sub-API classes ----------

/**
 * Manage webhook endpoints (the URLs that receive event deliveries).
 */
export class EndpointsAPI {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  /** Register a new webhook endpoint URL. */
  async create(params: CreateEndpointRequest): Promise<Endpoint> {
    return request<Endpoint>(
      this.baseUrl,
      this.apiKey,
      "POST",
      "/api/v1/endpoints",
      params
    );
  }

  /** List all registered endpoints for the authenticated user. */
  async list(): Promise<ListResponse<Endpoint>> {
    return request<ListResponse<Endpoint>>(
      this.baseUrl,
      this.apiKey,
      "GET",
      "/api/v1/endpoints"
    );
  }

  /** Delete an endpoint by ID. */
  async delete(id: string): Promise<void> {
    return request<void>(
      this.baseUrl,
      this.apiKey,
      "DELETE",
      `/api/v1/endpoints/${encodeURIComponent(id)}`
    );
  }
}

/**
 * Manage subscriptions that associate an endpoint with an event type and
 * optional filter conditions.
 */
export class SubscriptionsAPI {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  /** Create a new subscription. */
  async create(params: CreateSubscriptionRequest): Promise<Subscription> {
    return request<Subscription>(
      this.baseUrl,
      this.apiKey,
      "POST",
      "/api/v1/subscriptions",
      params
    );
  }

  /** List all subscriptions for the authenticated user. */
  async list(options?: ListOptions): Promise<ListResponse<Subscription>> {
    return request<ListResponse<Subscription>>(
      this.baseUrl,
      this.apiKey,
      "GET",
      "/api/v1/subscriptions",
      undefined,
      {
        limit: options?.limit,
        offset: options?.offset,
      }
    );
  }

  /** Get a single subscription by ID. */
  async get(id: string): Promise<Subscription> {
    return request<Subscription>(
      this.baseUrl,
      this.apiKey,
      "GET",
      `/api/v1/subscriptions/${encodeURIComponent(id)}`
    );
  }

  /** Update a subscription's conditions and/or enabled state. */
  async update(
    id: string,
    params: UpdateSubscriptionRequest
  ): Promise<Subscription> {
    return request<Subscription>(
      this.baseUrl,
      this.apiKey,
      "PATCH",
      `/api/v1/subscriptions/${encodeURIComponent(id)}`,
      params
    );
  }

  /** Delete a subscription by ID. */
  async delete(id: string): Promise<void> {
    return request<void>(
      this.baseUrl,
      this.apiKey,
      "DELETE",
      `/api/v1/subscriptions/${encodeURIComponent(id)}`
    );
  }
}

/**
 * Manage API keys used to authenticate against the webhook API.
 */
export class APIKeysAPI {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  /**
   * Create a new API key.
   *
   * The `key` field in the response contains the plaintext key value and will
   * only be returned once — store it securely.
   */
  async create(params: CreateAPIKeyRequest): Promise<APIKey> {
    return request<APIKey>(
      this.baseUrl,
      this.apiKey,
      "POST",
      "/api/v1/api-keys",
      params
    );
  }

  /** List all API keys for the authenticated user (plaintext values omitted). */
  async list(): Promise<ListResponse<APIKey>> {
    return request<ListResponse<APIKey>>(
      this.baseUrl,
      this.apiKey,
      "GET",
      "/api/v1/api-keys"
    );
  }

  /** Revoke an API key by ID. */
  async delete(id: string): Promise<void> {
    return request<void>(
      this.baseUrl,
      this.apiKey,
      "DELETE",
      `/api/v1/api-keys/${encodeURIComponent(id)}`
    );
  }
}

/**
 * Access delivery logs that record every webhook dispatch attempt.
 */
export class LogsAPI {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  /** List delivery logs for the authenticated user. */
  async list(options?: ListOptions): Promise<ListResponse<DeliveryLog>> {
    return request<ListResponse<DeliveryLog>>(
      this.baseUrl,
      this.apiKey,
      "GET",
      "/api/v1/logs",
      undefined,
      {
        limit: options?.limit,
        offset: options?.offset,
      }
    );
  }
}

/**
 * FlowScanWebhooks is the main entry point for the FlowScan Webhook SDK.
 *
 * @example
 * ```ts
 * import { FlowScanWebhooks } from "@flowscan/webhooks-sdk";
 *
 * const client = new FlowScanWebhooks({ apiKey: "fs_live_..." });
 *
 * // Create a webhook endpoint
 * const endpoint = await client.endpoints.create({ url: "https://example.com/hook" });
 *
 * // Subscribe to FT transfer events
 * const sub = await client.subscriptions.create({
 *   endpoint_id: endpoint.id,
 *   event_type: "ft.transfer",
 *   conditions: { token: "A.1654653399040a61.FlowToken", min_amount: "100.0" },
 * });
 * ```
 */
export class FlowScanWebhooks {
  /** Manage webhook delivery endpoints. */
  readonly endpoints: EndpointsAPI;
  /** Manage event subscriptions. */
  readonly subscriptions: SubscriptionsAPI;
  /** Manage API keys. */
  readonly keys: APIKeysAPI;
  /** Access delivery logs. */
  readonly logs: LogsAPI;

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: FlowScanConfig) {
    if (!config.apiKey) {
      throw new Error("FlowScanWebhooks: apiKey is required");
    }

    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

    this.endpoints = new EndpointsAPI(this.baseUrl, this.apiKey);
    this.subscriptions = new SubscriptionsAPI(this.baseUrl, this.apiKey);
    this.keys = new APIKeysAPI(this.baseUrl, this.apiKey);
    this.logs = new LogsAPI(this.baseUrl, this.apiKey);
  }

  /**
   * List all supported event type strings.
   *
   * This is a public endpoint and does not require authentication.
   */
  async listEventTypes(): Promise<{ items: WebhookEventType[]; count: number }> {
    const url = `${this.baseUrl}/api/v1/event-types`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new FlowScanError(
        `FlowScan API error: ${res.status} ${res.statusText}`,
        res.status
      );
    }

    return res.json() as Promise<{ items: WebhookEventType[]; count: number }>;
  }
}
