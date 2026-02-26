import { Outlet, createRootRoute, HeadContent, Scripts, ScrollRestoration } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import { WebSocketProvider } from '../components/WebSocketProvider';
import { ThemeProvider } from '../contexts/ThemeContext';
import { MobileMenuProvider } from '../contexts/MobileMenuContext';
import { Toaster } from 'react-hot-toast';
import { lazy, Suspense } from 'react';

const AIChatWidget = lazy(() => import('../components/chat/AIChatWidget'));
import '../index.css';

export const Route = createRootRoute({
    head: () => ({
        meta: [
            { title: 'FlowIndex' },
            { name: 'description', content: 'High-performance blockchain explorer for the Flow Network' },
            { property: 'og:title', content: 'FlowIndex' },
            { property: 'og:description', content: 'High-performance blockchain explorer for the Flow Network' },
            { property: 'og:image', content: 'https://flowindex.io/og/home' },
            { property: 'og:image:width', content: '1200' },
            { property: 'og:image:height', content: '630' },
            { property: 'og:url', content: 'https://flowindex.io' },
            { property: 'og:logo', content: 'https://flowindex.io/logo.png' },
            { property: 'og:type', content: 'website' },
            { property: 'og:site_name', content: 'FlowIndex' },
            { name: 'twitter:card', content: 'summary_large_image' },
            { name: 'twitter:title', content: 'FlowIndex' },
            { name: 'twitter:description', content: 'High-performance blockchain explorer for the Flow Network' },
            { name: 'twitter:image', content: 'https://flowindex.io/og/home' },
        ],
        links: [
            { rel: 'icon', href: '/favicon.png', type: 'image/png' },
        ],
    }),
    component: RootComponent,
})

function RootComponent() {
    return (
        <RootDocument>
            <ThemeProvider>
                <WebSocketProvider>
                    <MobileMenuProvider>
                    <div className="bg-gray-50 dark:bg-black min-h-screen text-zinc-700 dark:text-zinc-300 font-mono antialiased selection:bg-nothing-green selection:text-black flex transition-colors duration-300">
                        {/* Sidebar */}
                        <Sidebar />

                        {/* Main Content Area */}
                        <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
                            <Header />
                            <main className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden relative scroll-smooth focus:scroll-auto">
                                <div className="flex-1 flex flex-col relative">
                                    <Outlet />
                                </div>
                                <Footer />
                            </main>
                        </div>
                    </div>
                    <Suspense fallback={null}><AIChatWidget /></Suspense>
                    <Toaster position="bottom-right" />
                    </MobileMenuProvider>
                </WebSocketProvider>
            </ThemeProvider>
            <ScrollRestoration />
        </RootDocument>
    )
}

function RootDocument({ children }: { children: ReactNode }) {
    return (
        // Default theme is dark; render the initial document in dark mode to avoid a light->dark flash on first paint.
        // ThemeProvider can still toggle/remove the class after hydration for users who prefer light.
        <html lang="en" className="dark">
            <head>
                <meta charSet="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <meta name="color-scheme" content="dark" />
                {/* Title is set via route head() options + HeadContent */}
                {/* Runtime (public) config, populated in Docker/Railway via entrypoint envsubst */}
                <script src="/env.js"></script>
                <script defer src="https://analytics.flowindex.io/script.js" data-website-id="f7203f73-ea32-4a1d-a40c-575e559e53fb" id="umami-script"></script>
                <script dangerouslySetInnerHTML={{ __html: `
                  (function(){
                    var id = window.__FLOWSCAN_ENV__ && window.__FLOWSCAN_ENV__.UMAMI_WEBSITE_ID;
                    if (id) document.getElementById('umami-script').setAttribute('data-website-id', id);
                  })();
                `}} />
                {/* Route-scoped CSS + preloads generated from the Start manifest */}
                <HeadContent />
            </head>
            <body>
                <div id="root">{children}</div>
                {/* Router hydration + client entry */}
                <Scripts />
            </body>
        </html>
    )
}
