import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import compression from 'compression'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isProduction = process.env.NODE_ENV === 'production'
const port = process.env.PORT || 3000
const base = process.env.BASE || '/'

// Cached production assets
const templateHtml = isProduction
    ? fs.readFileSync(path.resolve(__dirname, './dist/client/index.html'), 'utf-8')
    : ''
const ssrManifest = isProduction
    ? fs.readFileSync(path.resolve(__dirname, './dist/client/.vite/ssr-manifest.json'), 'utf-8')
    : undefined

// Create server
const app = express()

// Add compression middleware
app.use(compression())

// Serve static files from dist/client
if (isProduction) {
    app.use(base, express.static(path.resolve(__dirname, './dist/client'), { index: false }))
}

// SSR handler
app.use('*', async (req, res) => {
    try {
        const url = req.originalUrl.replace(base, '')

        let template
        let render
        if (!isProduction) {
            // Development: create Vite server and load fresh modules
            const { createServer } = await import('vite')
            const vite = await createServer({
                server: { middlewareMode: true },
                appType: 'custom',
                base,
            })
            app.use(vite.middlewares)
            template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8')
            template = await vite.transformIndexHtml(url, template)
            render = (await vite.ssrLoadModule('/app/entry-server.tsx')).render
        } else {
            // Production: use pre-built assets
            template = templateHtml
            render = (await import('./dist/server/entry-server.js')).render
        }

        // Render app to HTML
        const { html: appHtml } = await render(url, ssrManifest)

        // Inject app HTML into template
        const html = template.replace(`<!--app-html-->`, appHtml)

        res.status(200).set({ 'Content-Type': 'text/html' }).end(html)
    } catch (e) {
        console.error(e)
        if (!isProduction) {
            const vite = await import('vite').then(m => m.createServer())
            vite.ssrFixStacktrace(e)
        }
        res.status(500).end(e.message)
    }
})

app.listen(port, () => {
    console.log(`Server started at http://localhost:${port}`)
})
