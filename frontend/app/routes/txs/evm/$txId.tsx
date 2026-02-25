import { createFileRoute, redirect } from '@tanstack/react-router'
import { resolveApiBaseUrl } from '../../../api'

export const Route = createFileRoute('/txs/evm/$txId')({
    loader: async ({ params }) => {
        // Resolve EVM hash → Cadence tx ID via the backend, then redirect
        const evmHash = params.txId.startsWith('0x') ? params.txId : `0x${params.txId}`;
        try {
            const baseUrl = await resolveApiBaseUrl();
            // Try direct Cadence lookup (works if EVM hash is indexed in evm_tx_hashes)
            const res = await fetch(`${baseUrl}/flow/transaction/${encodeURIComponent(evmHash)}?lite=true`);
            if (res.ok) {
                const json = await res.json();
                const rawTx: any = json?.data?.[0] ?? json;
                if (rawTx?.id && rawTx.id !== evmHash) {
                    throw redirect({ to: '/txs/$txId', params: { txId: rawTx.id }, search: {} });
                }
            }
        } catch (e) {
            if ((e as any)?.isRedirect || (e as any)?.to) throw e;
        }
        // Redirect to main tx page — it will fetch from Blockscout proxy as fallback
        throw redirect({ to: '/txs/$txId', params: { txId: evmHash }, search: {} });
    },
})
