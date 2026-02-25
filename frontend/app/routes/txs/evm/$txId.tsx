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
                const rawTx: any = json?.data?.[0] ?? json;
                if (rawTx?.id) {
                    throw redirect({ to: '/txs/$txId', params: { txId: rawTx.id }, search: {} });
                }
            }
        } catch (e) {
            if ((e as any)?.isRedirect || (e as any)?.to) throw e;
        }
        // If resolution failed, try loading directly with the EVM hash
        throw redirect({ to: '/txs/$txId', params: { txId: evmHash }, search: {} });
    },
})
