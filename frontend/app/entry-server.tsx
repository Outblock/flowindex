import { renderToString } from 'react-dom/server'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRouter } from './router'

export async function render(url: string) {
    // Create memory history for server
    const history = createMemoryHistory({
        initialEntries: [url],
    })

    // Create router with server-side history
    const router = createRouter()
    router.update({
        history,
    })

    // Wait for router to load all data
    await router.load()

    // Render to string
    const html = renderToString(
        <StrictMode>
            <RouterProvider router={router} />
        </StrictMode>
    )

    return { html, router }
}
