import { useState, useEffect } from 'react';
import { fcl } from './fclConfig';

const GET_COA_SCRIPT = `
import EVM from 0xEVM

access(all) fun main(flowAddress: Address): String? {
    if let address: EVM.EVMAddress = getAuthAccount<auth(BorrowValue) &Account>(flowAddress)
        .storage.borrow<&EVM.CadenceOwnedAccount>(from: /storage/evm)?.address() {
        let bytes: [UInt8] = []
        for byte in address.bytes {
            bytes.append(byte)
        }
        return String.encodeHex(bytes)
    }
    return nil
}
`;

/**
 * Fetch the COA (Cadence-Owned Account) EVM address for a Flow address.
 * Returns null if the account has no COA, or while loading.
 */
export function useCoaAddress(flowAddress: string | null): string | null {
  const [coaAddress, setCoaAddress] = useState<string | null>(null);

  useEffect(() => {
    if (!flowAddress) { setCoaAddress(null); return; }
    let cancelled = false;
    const addr = flowAddress.startsWith('0x') ? flowAddress : `0x${flowAddress}`;

    fcl.query({
      cadence: GET_COA_SCRIPT,
      args: (arg: typeof fcl.arg, t: typeof fcl.t) => [arg(addr, t.Address)],
    }).then((result: string | null) => {
      if (!cancelled) {
        setCoaAddress(result ? `0x${result}` : null);
      }
    }).catch(() => {
      if (!cancelled) setCoaAddress(null);
    });

    return () => { cancelled = true; };
  }, [flowAddress]);

  return coaAddress;
}
