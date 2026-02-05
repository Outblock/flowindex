FROM golang:1.24-bookworm AS builder

WORKDIR /app

# standard debian image has gcc


COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ .
RUN go mod tidy
RUN CGO_CFLAGS="-std=gnu99" CGO_ENABLED=1 go build -o indexer main.go
RUN CGO_CFLAGS="-std=gnu99" CGO_ENABLED=1 go build -o backfill_token_transfers ./cmd/tools/backfill_token_transfers

FROM debian:bookworm-slim

WORKDIR /app

# TLS CA certificates for outbound HTTPS (e.g. coingecko)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/indexer .
COPY --from=builder /app/backfill_token_transfers .
# Copy schema for potential migration on startup (optional, user does it manually now)
COPY --from=builder /app/schema_v2.sql .
COPY --from=builder /app/docs ./docs

EXPOSE 8080

CMD ["./indexer"]
