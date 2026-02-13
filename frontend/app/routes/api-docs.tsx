import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

const ApiDocs = lazy(() => import('../components/ApiDocs'))

export const Route = createFileRoute('/api-docs')({
    component: ApiDocsPage,
})

function ApiDocsPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-white dark:bg-black flex items-center justify-center"><p className="text-zinc-500 text-xs uppercase tracking-widest animate-pulse">Loading API Docs...</p></div>}>
            <ApiDocs specUrl="/openapi/v2.json" />
        </Suspense>
    )
}
