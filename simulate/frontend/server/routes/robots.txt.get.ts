import { defineEventHandler } from 'h3'

export default defineEventHandler(() => {
  return `User-agent: *
Allow: /
Sitemap: https://simulate.flowindex.io/sitemap.xml
`
})
