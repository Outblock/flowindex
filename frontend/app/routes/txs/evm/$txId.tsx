import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/txs/evm/$txId')({
    loader: async ({ params }) => {
        const evmHash = params.txId.startsWith('0x') ? params.txId : `0x${params.txId}`;
        // Redirect to main tx page with ?view=evm to render EVMTxDetail directly
        throw redirect({ to: '/txs/$txId', params: { txId: evmHash }, search: { view: 'evm' } });
    },
})
