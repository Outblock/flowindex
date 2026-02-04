# FlowScan Developer Portal

This is the FlowScan developer portal (Fumadocs + Scalar).

## Local Dev

Start the portal:

```bash
cd devportal

# Point the portal's /flowscan-api/* proxy to a backend instance
export BACKEND_API_URL="http://localhost:8080"

npm run dev
```

Open:
- `http://localhost:3000` (portal home)
- `http://localhost:3000/docs` (docs)
- `http://localhost:3000/api-reference` (interactive API reference)

## How It Works

- Docs: MDX content in `devportal/content/docs/*` rendered by Fumadocs.
- API Reference: `devportal/app/api-reference/page.tsx` renders Scalar and loads the OpenAPI spec.
- Backend proxy: `devportal/next.config.mjs` proxies `/flowscan-api/*` to `BACKEND_API_URL` so the API
  reference can do same-origin "Try It" requests without CORS.

## Environment Variables

- `BACKEND_API_URL` (required in production):
  - Example (Railway private network): `http://backend.railway.internal:8080`
  - Example (local): `http://localhost:8080`
- `NEXT_PUBLIC_OPENAPI_URL` (optional):
  - Defaults to `/flowscan-api/openapi.yaml`
- `NEXT_PUBLIC_API_BASE_URL` (optional):
  - Defaults to `/flowscan-api`

## Docker

Build + run:

```bash
docker build -f devportal/Dockerfile -t flowscan-devportal .
docker run --rm -p 3000:8080 \
  -e PORT=8080 \
  -e BACKEND_API_URL="http://host.docker.internal:8080" \
  flowscan-devportal
```

## Explore

In the project, you can see:

- `lib/source.ts`: Code for content source adapter, [`loader()`](https://fumadocs.dev/docs/headless/source-api) provides the interface to access your content.
- `lib/layout.shared.tsx`: Shared options for layouts, optional but preferred to keep.

| Route                     | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `app/(home)`              | The route group for your landing page and other pages. |
| `app/docs`                | The documentation layout and pages.                    |
| `app/api/search/route.ts` | The Route Handler for portal search.                   |
| `app/api-reference`       | Scalar-based API Reference UI.                          |

### Fumadocs MDX

A `source.config.ts` config file has been included, you can customise different options like frontmatter schema.

Read the [Introduction](https://fumadocs.dev/docs/mdx) for further details.

## Learn More

To learn more about Next.js and Fumadocs, take a look at the following
resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Fumadocs](https://fumadocs.dev) - learn about Fumadocs
