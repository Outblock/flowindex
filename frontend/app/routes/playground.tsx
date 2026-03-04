import { createFileRoute, useSearch } from '@tanstack/react-router'

export const Route = createFileRoute('/playground')({
    validateSearch: (search: Record<string, unknown>) => ({
        code: (search.code as string) || undefined,
        args: (search.args as string) || undefined,
        network: (search.network as string) || undefined,
        tx: (search.tx as string) || undefined,
    }),
    component: PlaygroundPage,
})

function PlaygroundPage() {
    const RUNNER_URL = import.meta.env.VITE_RUNNER_URL || 'https://run.flowindex.io'
    const search = useSearch({ from: '/playground' })

    // Forward query params to the runner iframe
    const params = new URLSearchParams()
    if (search.tx) params.set('tx', search.tx)
    if (search.code) params.set('code', search.code)
    if (search.args) params.set('args', search.args)
    if (search.network) params.set('network', search.network)
    const query = params.toString()
    const iframeSrc = query ? `${RUNNER_URL}?${query}` : RUNNER_URL

    return (
        <div className="flex-1 -mb-16">
            <iframe
                src={iframeSrc}
                className="w-full h-[calc(100vh-5.5rem)] border-0 bg-background"
                allow="clipboard-write"
                title="Cadence Runner"
            />
        </div>
    )
}
