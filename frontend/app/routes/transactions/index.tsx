import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/transactions/')({
    beforeLoad: () => {
        throw redirect({ to: '/txs' })
    },
})
