import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

const NotFound = lazy(() => import('../components/NotFound'))

export const Route = createFileRoute('/$')({
    component: () => (
        <Suspense fallback={<div className="min-h-screen bg-black" />}>
            <NotFound />
        </Suspense>
    ),
})
