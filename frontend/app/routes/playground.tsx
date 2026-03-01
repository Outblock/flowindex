import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/playground')({
    component: PlaygroundPage,
})

function PlaygroundPage() {
    const RUNNER_URL = import.meta.env.VITE_RUNNER_URL || 'https://run.flowindex.io'

    return (
        <div className="flex-1 -mb-16">
            <iframe
                src={RUNNER_URL}
                className="w-full h-[calc(100vh-5.5rem)] border-0"
                allow="clipboard-write"
                title="Cadence Runner"
            />
        </div>
    )
}
