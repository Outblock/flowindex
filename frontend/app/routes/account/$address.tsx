import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/account/$address')({
    beforeLoad: ({ params }) => {
        throw redirect({ to: '/accounts/$address', params: { address: params.address }, search: {} })
    },
})
