import { createRootRoute, Outlet, HeadContent, Scripts } from '@tanstack/react-router'
import { Navbar } from '@/components/navbar'
import { Footer } from '@/components/footer'
import appCss from '@/index.css?url'

const SITE_URL = 'https://simulate.flowindex.io'
const TITLE = 'FlowIndex Simulator — Transaction Simulator for Flow'
const DESCRIPTION =
  'Simulate Flow transactions against real mainnet state. See balance changes, events, and errors before signing.'
const OG_IMAGE = `${SITE_URL}/og.png`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },
      // OpenGraph
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: SITE_URL },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:image', content: OG_IMAGE },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: 'FlowIndex Simulator — simulate Flow transactions against mainnet state' },
      { property: 'og:site_name', content: 'FlowIndex Simulator' },
      // Twitter Card
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESCRIPTION },
      { name: 'twitter:image', content: OG_IMAGE },
      // Additional SEO
      { name: 'theme-color', content: '#00ef8b' },
      { name: 'color-scheme', content: 'dark' },
      { name: 'robots', content: 'index, follow' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'canonical', href: SITE_URL },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    ],
  }),
  component: RootLayout,
})

function RootLayout() {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebApplication',
              name: 'FlowIndex Simulator',
              url: SITE_URL,
              description: DESCRIPTION,
              applicationCategory: 'DeveloperApplication',
              operatingSystem: 'Web',
              offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
              creator: { '@type': 'Organization', name: 'FlowIndex', url: 'https://flowindex.io' },
            }),
          }}
        />
        <script defer src="https://analytics.flowindex.io/script.js" data-website-id="bf956be7-611d-4c66-867c-c481209cc99c"></script>
      </head>
      <body>
        <Navbar />
        <Outlet />
        <Footer />
        <Scripts />
      </body>
    </html>
  )
}
