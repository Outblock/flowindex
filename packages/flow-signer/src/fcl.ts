import type { FlowSigner } from './interface.js';

export function createAuthzFromSigner(signer: FlowSigner) {
  const info = signer.info();
  return async (account: Record<string, unknown>) => ({
    ...account,
    tempId: `${info.flowAddress}-${info.keyIndex}`,
    addr: info.flowAddress?.replace(/^0x/, ''),
    keyId: info.keyIndex,
    signingFunction: async (signable: { message: string }) => {
      const result = await signer.signFlowTransaction(signable.message);
      return {
        addr: info.flowAddress?.replace(/^0x/, ''),
        keyId: info.keyIndex,
        signature: result.signature,
        ...(result.extensionData ? { extensionData: result.extensionData } : {}),
      };
    },
  });
}
