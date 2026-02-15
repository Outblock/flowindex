import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/transactions/$txId')({
    beforeLoad: ({ params }) => {
        throw redirect({ to: '/tx/$txId', params: { txId: params.txId }, search: {} as any })
    },
})
