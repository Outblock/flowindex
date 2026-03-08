import type { FlowSigner, SignResult, SignerInfo } from './interface.js';
import type { AgentWalletConfig } from '../config/env.js';

// ---------------------------------------------------------------------------
// PasskeySigner — browser-based passkey approval flow (NOT headless)
//
// Flow:
//  1. POST /api/v1/wallet/approve to create an approval request
//  2. Surface the approve_url to the user / LLM
//  3. Poll GET /api/v1/wallet/approve/{id} until approved/rejected/expired
//  4. Return the signature
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 300_000; // 5 minutes — matches backend expiry

/** Envelope returned by the Go API: { data: {...}, error: {...} } */
interface ApiEnvelope<T> {
  data?: T;
  error?: { message: string };
}

interface ApprovalCreateData {
  request_id: string;
  approve_url: string;
  expires_in: number;
}

interface ApprovalPollData {
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  signature?: string;
}

/** Metadata about the transaction being signed, set before calling signFlowTransaction. */
export interface PendingTxMeta {
  description?: string;
  cadenceScript?: string;
  cadenceArgs?: string;
}

export class PasskeySigner implements FlowSigner {
  private readonly config: AgentWalletConfig;
  private token?: string;

  private flowAddress?: string;
  private evmAddress?: string;
  private keyIndex = 0;

  /** Metadata for the next signFlowTransaction call. */
  private pendingMeta: PendingTxMeta = {};

  /** The last approve_url returned by the backend, so tools can surface it. */
  private lastApproveUrl?: string;
  private lastRequestId?: string;

  constructor(config: AgentWalletConfig) {
    this.config = config;
  }

  // ---- Token management ---------------------------------------------------

  /** Inject or replace the wallet JWT token. */
  setToken(token: string): void {
    this.token = token;
  }

  // ---- Pending TX metadata ------------------------------------------------

  /** Set metadata for the next transaction to be signed. */
  setPendingMeta(meta: PendingTxMeta): void {
    this.pendingMeta = meta;
  }

  /** Return the last approve_url so tools can surface it to the LLM/user. */
  getApproveUrl(): string | undefined {
    return this.lastApproveUrl;
  }

  /** Return the last request_id. */
  getRequestId(): string | undefined {
    return this.lastRequestId;
  }

  // ---- FlowSigner implementation ------------------------------------------

  async init(): Promise<void> {
    // Passkey signer discovers the account during the interactive
    // approval flow. For now, use the explicitly configured address.
    this.flowAddress = this.config.flowAddress;
    this.keyIndex = this.config.flowKeyIndex;
    this.token = this.config.flowindexToken;
  }

  info(): SignerInfo {
    return {
      type: 'passkey',
      flowAddress: this.flowAddress,
      evmAddress: this.evmAddress,
      keyIndex: this.keyIndex,
      sigAlgo: 'ECDSA_P256',
      hashAlgo: 'SHA2_256',
    };
  }

  async signFlowTransaction(messageHex: string): Promise<SignResult> {
    if (!this.token) {
      throw new Error('PasskeySigner: no token set. Call setToken() or init() first.');
    }

    // Step 1: Create approval request
    const createResp = await fetch(
      `${this.config.flowindexUrl}/api/v1/wallet/approve`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tx_message_hex: messageHex,
          description: this.pendingMeta.description || '',
          cadence_script: this.pendingMeta.cadenceScript || '',
          cadence_args: this.pendingMeta.cadenceArgs || '',
        }),
      },
    );

    if (!createResp.ok) {
      const body = await createResp.text();
      throw new Error(`PasskeySigner: failed to create approval (${createResp.status}): ${body}`);
    }

    const createEnvelope = (await createResp.json()) as ApiEnvelope<ApprovalCreateData>;
    if (createEnvelope.error) {
      throw new Error(`PasskeySigner: ${createEnvelope.error.message}`);
    }
    if (!createEnvelope.data) {
      throw new Error('PasskeySigner: empty response from approval create');
    }

    const { request_id, approve_url } = createEnvelope.data;
    this.lastApproveUrl = approve_url;
    this.lastRequestId = request_id;

    // Clear pending meta after use
    this.pendingMeta = {};

    // Step 2: Poll for approval
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);

      const pollResp = await fetch(
        `${this.config.flowindexUrl}/api/v1/wallet/approve/${encodeURIComponent(request_id)}`,
        {
          headers: { Authorization: `Bearer ${this.token}` },
        },
      );

      if (!pollResp.ok) continue;

      const pollEnvelope = (await pollResp.json()) as ApiEnvelope<ApprovalPollData>;
      const status = pollEnvelope.data;
      if (!status) continue;

      if (status.status === 'approved' && status.signature) {
        return { signature: status.signature };
      }

      if (status.status === 'rejected') {
        throw new Error('PasskeySigner: approval rejected by user');
      }

      if (status.status === 'expired') {
        throw new Error('PasskeySigner: approval request expired');
      }
    }

    throw new Error('PasskeySigner: approval timed out');
  }

  isHeadless(): boolean {
    return false;
  }

  // ---- Getters ------------------------------------------------------------

  getFlowAddress(): string | undefined {
    return this.flowAddress;
  }

  getKeyIndex(): number {
    return this.keyIndex;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
