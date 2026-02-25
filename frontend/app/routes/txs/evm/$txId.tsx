import { createFileRoute, redirect } from '@tanstack/react-router'
import { resolveApiBaseUrl } from '../../../api'

export const Route = createFileRoute('/txs/evm/$txId')({
    loader: async ({ params }) => {
        // Resolve EVM hash → Cadence tx ID via the backend, then redirect
        const evmHash = params.txId.startsWith('0x') ? params.txId : `0x${params.txId}`;
        try {
            const baseUrl = await resolveApiBaseUrl();
            const res = await fetch(`${baseUrl}/flow/transaction?evm_hash=${encodeURIComponent(evmHash)}&lite=true&limit=1`);
            if (res.ok) {
                const json = await res.json();
                const cadenceTx = json?.data?.[0];
                if (cadenceTx?.id) {
                    throw redirect({ to: '/txs/$txId', params: { txId: cadenceTx.id }, search: {} });
                }
            }
        } catch (e) {
            if ((e as any)?.isRedirect || (e as any)?.to) throw e;
        }
        // EVM hash not found in our index — show not found
        throw redirect({ to: '/txs/$txId', params: { txId: evmHash }, search: {} });
    },
})
