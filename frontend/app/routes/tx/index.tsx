import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/tx/')({
    beforeLoad: () => {
        throw redirect({ to: '/txs' })
    },
})
