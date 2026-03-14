# check=skip=SecretsUsedInArgOrEnv
FROM oven/bun:1 AS frontend-builder
WORKDIR /app

# Workspace root config + lockfile
COPY package.json bun.lock nx.json ./

# Shared monorepo packages (needed for workspace:* resolution)
COPY packages/ ./packages/

# Runner package.json
COPY runner/package.json ./runner/

# Scope workspaces to only what's present (bun requires all listed members to exist)
RUN bun -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8'));p.workspaces=['packages/*','runner'];require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"

# Install all workspace deps
RUN cd runner && bun install

# Build shared packages (nx resolves dependency order via tag:package)
RUN bunx nx run-many -t build --projects=tag:package

# Copy runner source and build
COPY runner/ ./runner/
WORKDIR /app/runner
ARG VITE_AI_CHAT_URL=https://ai.flowindex.io
ARG VITE_SUPABASE_URL=
ARG VITE_SUPABASE_ANON_KEY=
ARG VITE_GOTRUE_URL=
ENV VITE_AI_CHAT_URL=$VITE_AI_CHAT_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_GOTRUE_URL=$VITE_GOTRUE_URL
RUN bun run build

FROM oven/bun:1 AS server-builder
WORKDIR /app/server
COPY runner/server/package.json runner/server/bun.lock* ./
RUN bun install
COPY runner/server/ .
RUN bun run build

FROM nginx:alpine
# Install Node.js runtime, supervisord, and glibc compatibility for Flow CLI
RUN apk add --no-cache nodejs supervisor gcompat libc6-compat
# Install Flow CLI
RUN FLOW_CLI_VERSION=v2.14.3 \
    && wget -qO /tmp/flow-cli.tar.gz \
    "https://github.com/onflow/flow-cli/releases/download/${FLOW_CLI_VERSION}/flow-cli-${FLOW_CLI_VERSION}-linux-amd64.tar.gz" \
    && tar -xzf /tmp/flow-cli.tar.gz -C /tmp \
    && FLOW_BIN="$(find /tmp -maxdepth 2 -type f \( -name flow -o -name flow-cli \) | head -n 1)" \
    && test -n "$FLOW_BIN" \
    && mv "$FLOW_BIN" /usr/local/bin/flow \
    && chmod +x /usr/local/bin/flow \
    && rm -f /tmp/flow-cli.tar.gz
# Install Solidity Language Server (Rust binary)
RUN SOL_LSP_VERSION=v0.1.32 \
    && wget -qO /tmp/sol-lsp.tar.gz \
    "https://github.com/mmsaki/solidity-language-server/releases/download/${SOL_LSP_VERSION}/solidity-language-server-x86_64-unknown-linux-gnu.tar.gz" \
    && tar -xzf /tmp/sol-lsp.tar.gz -C /usr/local/bin/ \
    && chmod +x /usr/local/bin/solidity-language-server \
    && rm -f /tmp/sol-lsp.tar.gz
# Copy frontend static files
COPY --from=frontend-builder /app/runner/dist /usr/share/nginx/html
# Copy server
COPY --from=server-builder /app/server/dist /app/server
COPY --from=server-builder /app/server/node_modules /app/server/node_modules
# Copy configs — nginx.conf is a template, resolved at runtime by entrypoint
RUN mkdir -p /etc/nginx/templates
COPY runner/nginx.conf /etc/nginx/templates/default.conf.template
COPY runner/supervisord.conf /etc/supervisord.conf
COPY runner/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 80 3003 3004
ENTRYPOINT ["/entrypoint.sh"]
CMD ["supervisord", "-c", "/etc/supervisord.conf"]
