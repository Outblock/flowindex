FROM oven/bun:1.3-alpine

WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY src/ src/
COPY tsconfig.json ./

EXPOSE 4000
ENV PORT=4000
CMD ["bun", "run", "src/index.ts"]
