import * as fcl from '@onflow/fcl';

export function sendReady() {
  fcl.WalletUtils.sendMsgToFCL('FCL:VIEW:READY');
}

export function approve(data: unknown) {
  fcl.WalletUtils.approve(data);
}

export function decline(reason: string) {
  fcl.WalletUtils.decline(reason);
}

export function close() {
  fcl.WalletUtils.close();
}

export interface ReadyResponseData {
  type: string;
  body?: Record<string, unknown>;
  data?: unknown;
  config?: Record<string, unknown>;
}

/**
 * Send READY and listen for FCL:VIEW:READY:RESPONSE from the host app.
 * Returns cleanup function.
 */
export function onReadyResponse(
  callback: (data: ReadyResponseData) => void,
): () => void {
  const handler = (event: MessageEvent) => {
    if (event.data?.type === 'FCL:VIEW:READY:RESPONSE') {
      callback(event.data);
    }
  };
  window.addEventListener('message', handler);
  // Send READY to trigger the response
  sendReady();
  return () => window.removeEventListener('message', handler);
}
