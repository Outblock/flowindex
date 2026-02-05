FROM oven/bun:1 AS deps

# We build from the repository root context so the portal can reuse `../docs/*`.
WORKDIR /app/devportal

# NOTE: fumadocs-mdx runs on postinstall and requires source.config.ts + docs content.
# Copy just enough for dependency install to succeed (before we copy the whole app).
COPY devportal/package.json devportal/bun.lock devportal/source.config.ts devportal/tsconfig.json devportal/mdx-components.tsx ./
COPY docs /app/docs

RUN bun install --frozen-lockfile

FROM oven/bun:1 AS builder

WORKDIR /app/devportal
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/devportal/node_modules ./node_modules
COPY devportal/ ./
COPY docs /app/docs

# Some setups omit `public/`, but our runtime image expects it.
RUN mkdir -p public

RUN bun run build

# Railway (and many container runtimes) set $HOSTNAME to the container ID.
# Next.js standalone uses that to bind, which can end up on a loopback address.
# Force bind to 0.0.0.0 so Railway Edge can reach the service.
RUN find .next/standalone -name server.js -maxdepth 6 -print -exec sed -i "s/const hostname = process\\.env\\.HOSTNAME || '0\\.0\\.0\\.0'/const hostname = '0.0.0.0'/" {} +

FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080

# Next.js standalone output
#
# NOTE: because we set `outputFileTracingRoot` to the repo root, Next's standalone
# output is rooted at `.next/standalone/devportal/*` (not `.next/standalone/*`).
COPY --from=builder /app/devportal/.next/standalone/devportal ./devportal
COPY --from=builder /app/devportal/.next/static ./devportal/.next/static
COPY --from=builder /app/devportal/public ./devportal/public

# Fumadocs sources markdown from `../docs`, so ensure the docs directory exists at runtime.
COPY --from=builder /app/docs ./docs

EXPOSE 8080

WORKDIR /app/devportal
CMD ["node", "server.js"]
