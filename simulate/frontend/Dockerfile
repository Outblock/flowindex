FROM oven/bun:1 AS builder
WORKDIR /app

# Workspace root config + lockfile
COPY package.json bun.lock ./

# Shared monorepo packages (needed for workspace:* resolution)
COPY packages/ ./packages/

# Simulate frontend package.json
COPY simulate/frontend/package.json ./simulate/frontend/

# Scope workspaces to only what's present
RUN bun -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8'));p.workspaces=['packages/*','simulate/frontend'];require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"

# Install all workspace deps
RUN cd simulate/frontend && bun install

# Build event-decoder package (generate dist/ via tsup)
RUN cd packages/event-decoder && bun run build

# Copy simulate frontend source and build
COPY simulate/frontend/ ./simulate/frontend/
WORKDIR /app/simulate/frontend

ARG SIMULATOR_BACKEND_URL=http://10.128.0.5:9090
ENV SIMULATOR_BACKEND_URL=$SIMULATOR_BACKEND_URL

RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/simulate/frontend/.output .output

ENV PORT=3000
EXPOSE 3000

CMD ["bun", ".output/server/index.mjs"]
