import { createHmac, timingSafeEqual } from "crypto";

/**
 * The set of HTTP headers sent by Svix with every webhook delivery.
 */
export interface WebhookHeaders {
  /** Unique message identifier, e.g. "msg_2abc..." */
  "webhook-id": string;
  /** Unix timestamp (seconds) of when the message was sent, e.g. "1714000000" */
  "webhook-timestamp": string;
  /**
   * One or more space-separated Base64-encoded HMAC-SHA256 signatures.
   * Svix rotates signing secrets during key rollover, so multiple signatures
   * may be present.  At least one must match for verification to succeed.
   * Format: "v1,<base64>" e.g. "v1,abc123=="
   */
  "webhook-signature": string;
}

/**
 * WebhookVerificationError is thrown when signature verification fails.
 */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

/**
 * Maximum allowed age (in milliseconds) of an incoming webhook message.
 * Messages older than this threshold are rejected to prevent replay attacks.
 */
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Verify the authenticity of an incoming webhook request using the Svix
 * standard signing scheme (HMAC-SHA256, Base64-encoded).
 *
 * The function checks:
 * 1. All required Svix headers are present.
 * 2. The `webhook-timestamp` is within the 5-minute tolerance window.
 * 3. At least one signature in `webhook-signature` matches the computed
 *    HMAC-SHA256 of `${webhook-id}.${webhook-timestamp}.${payload}` using
 *    the provided secret.
 *
 * @param payload  The raw (unparsed) request body string.
 * @param headers  The Svix webhook headers from the incoming request.
 * @param secret   The webhook signing secret (starts with "whsec_", Base64-encoded).
 * @throws {WebhookVerificationError} if verification fails for any reason.
 *
 * @example
 * ```ts
 * import { verifyWebhookSignature } from "@flowscan/webhooks-sdk";
 *
 * app.post("/webhook", (req, res) => {
 *   try {
 *     verifyWebhookSignature(req.rawBody, req.headers as any, process.env.WEBHOOK_SECRET!);
 *   } catch (err) {
 *     return res.status(400).send("Invalid signature");
 *   }
 *   // Process req.body ...
 *   res.sendStatus(200);
 * });
 * ```
 */
export function verifyWebhookSignature(
  payload: string,
  headers: WebhookHeaders,
  secret: string
): void {
  // --- 1. Validate required headers ---
  const msgId = headers["webhook-id"];
  const msgTimestamp = headers["webhook-timestamp"];
  const msgSignature = headers["webhook-signature"];

  if (!msgId || !msgTimestamp || !msgSignature) {
    throw new WebhookVerificationError(
      "Missing required Svix headers: webhook-id, webhook-timestamp, webhook-signature"
    );
  }

  // --- 2. Validate timestamp to prevent replay attacks ---
  const timestampSeconds = parseInt(msgTimestamp, 10);
  if (isNaN(timestampSeconds)) {
    throw new WebhookVerificationError(
      `Invalid webhook-timestamp value: "${msgTimestamp}"`
    );
  }

  const now = Date.now();
  const messageAgeMs = now - timestampSeconds * 1000;

  if (Math.abs(messageAgeMs) > TIMESTAMP_TOLERANCE_MS) {
    throw new WebhookVerificationError(
      `Webhook timestamp is too old or too far in the future (age: ${Math.round(messageAgeMs / 1000)}s, tolerance: ${TIMESTAMP_TOLERANCE_MS / 1000}s)`
    );
  }

  // --- 3. Derive the raw HMAC key from the secret ---
  // Svix secrets are prefixed with "whsec_" followed by a Base64-encoded key.
  const secretBytes = deriveSecretBytes(secret);

  // --- 4. Compute the expected HMAC ---
  // Svix signed content: "<webhook-id>.<webhook-timestamp>.<payload>"
  const signedContent = `${msgId}.${msgTimestamp}.${payload}`;
  const expectedHmac = createHmac("sha256", secretBytes)
    .update(signedContent, "utf8")
    .digest();

  // --- 5. Compare against each provided signature ---
  const signatures = msgSignature.split(" ");
  let verified = false;

  for (const sig of signatures) {
    // Svix format: "v1,<base64>"
    const commaIndex = sig.indexOf(",");
    if (commaIndex === -1) {
      continue; // Malformed signature entry — skip.
    }

    const version = sig.slice(0, commaIndex);
    const b64 = sig.slice(commaIndex + 1);

    if (version !== "v1") {
      // Unknown version prefix — skip rather than fail so future versions
      // can coexist with v1 during rollover.
      continue;
    }

    let sigBytes: Buffer;
    try {
      sigBytes = Buffer.from(b64, "base64");
    } catch {
      continue; // Invalid Base64 — skip.
    }

    if (sigBytes.length !== expectedHmac.length) {
      continue;
    }

    if (timingSafeEqual(expectedHmac, sigBytes)) {
      verified = true;
      break;
    }
  }

  if (!verified) {
    throw new WebhookVerificationError(
      "No valid signature found — webhook verification failed"
    );
  }
}

// ---------- Internal helpers ----------

/**
 * Decode the raw signing-key bytes from a Svix secret.
 *
 * Svix secrets have the form "whsec_<base64>" where the Base64 portion is the
 * raw HMAC key.  If the secret does not have the "whsec_" prefix it is assumed
 * to already be raw Base64.
 */
function deriveSecretBytes(secret: string): Buffer {
  const base64 = secret.startsWith("whsec_")
    ? secret.slice("whsec_".length)
    : secret;

  try {
    return Buffer.from(base64, "base64");
  } catch {
    throw new WebhookVerificationError(
      'Failed to decode webhook secret — expected "whsec_<base64>" or a raw Base64 string'
    );
  }
}
