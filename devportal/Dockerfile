FROM node:20-bookworm AS deps

WORKDIR /app
# NOTE: fumadocs-mdx runs on postinstall and requires source.config.ts + content.
# We copy just enough inputs here so `npm ci` can run successfully.
COPY package.json package-lock.json source.config.ts tsconfig.json mdx-components.tsx ./
COPY content ./content
RUN npm ci

FROM node:20-bookworm AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN mkdir -p public
RUN npm run build

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
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 8080

CMD ["node", "server.js"]
