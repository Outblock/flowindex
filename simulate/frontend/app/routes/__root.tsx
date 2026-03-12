import { createRootRoute, Outlet, HeadContent, Scripts } from '@tanstack/react-router'
import { Navbar } from '@/components/navbar'
import { Footer } from '@/components/footer'
import appCss from '@/index.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'FlowIndex Simulator — Transaction Simulator for Flow' },
      { name: 'description', content: 'Simulate Flow transactions against real mainnet state. See balance changes, events, and errors before signing.' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  component: RootLayout,
})

function RootLayout() {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
        <script defer src="https://analytics.flowindex.io/script.js" data-website-id="bf956be7-611d-4c66-867c-c481209cc99c" id="umami-script"></script>
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var el = document.getElementById('umami-script');
            if (el && !el.getAttribute('data-website-id')) {
              el.setAttribute('data-website-id', 'bf956be7-611d-4c66-867c-c481209cc99c');
            }
          })();
        `}} />
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
