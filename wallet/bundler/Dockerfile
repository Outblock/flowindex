FROM oven/bun:1.3
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install
COPY paymaster-service.ts ./
EXPOSE 4338
CMD ["bun", "run", "paymaster-service.ts"]
