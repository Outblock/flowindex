import { Outlet, createRootRoute, ScrollRestoration } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import { IndexingStatus } from '../components/IndexingStatus';
import { WebSocketProvider } from '../components/WebSocketProvider';
import { ThemeProvider } from '../contexts/ThemeContext';
import { Toaster } from 'react-hot-toast';
import '../index.css';

export const Route = createRootRoute({
    component: RootComponent,
})

function RootComponent() {
    return (
        <RootDocument>
            <ThemeProvider>
                <WebSocketProvider>
                    <div className="bg-gray-50 dark:bg-black min-h-screen text-zinc-700 dark:text-zinc-300 font-mono antialiased selection:bg-nothing-green selection:text-black flex transition-colors duration-300">
                        {/* Sidebar */}
                        <Sidebar />

                        {/* Main Content Area */}
                        <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
                            <IndexingStatus />
                            <Header />
                            <main className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden relative scroll-smooth focus:scroll-auto">
                                <div className="flex-1 flex flex-col relative">
                                    <Outlet />
                                </div>
                                <Footer />
                            </main>
                        </div>
                    </div>
                    <Toaster position="bottom-right" />
                </WebSocketProvider>
            </ThemeProvider>
            <ScrollRestoration />
        </RootDocument>
    )
}

function RootDocument({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <head>
                <meta charSet="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>FlowScan</title>
            </head>
            <body>
                <div id="root">{children}</div>
            </body>
        </html>
    )
}
