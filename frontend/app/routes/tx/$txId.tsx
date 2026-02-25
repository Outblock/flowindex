import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/tx/$txId')({
    beforeLoad: ({ params }) => {
        throw redirect({ to: '/txs/$txId', params: { txId: params.txId } })
    },
})
