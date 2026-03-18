# Build optimized emulator from Outblock fork
# Features: safer fork-mode register fetching, cache-poisoning fix, watchdog recovery
FROM golang:1.25-bookworm AS builder

# Pin the emulator revision so CI builds are reproducible and cache-busted when the ref changes.
ARG EMULATOR_REF=main

RUN git clone https://github.com/Outblock/flow-emulator.git /src \
  && cd /src \
  && git checkout "$EMULATOR_REF"
WORKDIR /src

# Disable batch register prefetch in fork mode. After ~2-5 minutes, the
# mainnet access node prunes execution data for the fork-height block.
# The prefetchRegistersForOwner function makes a gRPC batch call per unique
# account owner (~10+ per tx). When pruned, each call fails with NotFound
# but still takes ~1s of gRPC overhead → 10+ seconds of wasted latency.
# resolveRegister() already handles individual register resolution via
# SQLite (fast, registers are warm from the warmup phase) with gRPC fallback.
RUN sed -i '/^func (s \*Store) prefetchRegistersForOwner/,/^}/c\func (s *Store) prefetchRegistersForOwner(_ context.Context, _ string, _ uint64) {}' \
    storage/remote/store.go

ENV GOTOOLCHAIN=auto
RUN CGO_CFLAGS="-std=gnu99" CGO_ENABLED=1 go build -o /emulator ./cmd/emulator

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /emulator /bin/app
RUN mkdir -p /data/flowdb
ENTRYPOINT ["/bin/app"]

EXPOSE 8888 3569 8080

CMD [ \
  "emulator", "start", \
  "--fork-host", "access.mainnet.nodes.onflow.org:9000", \
  "--persist", \
  "--snapshot", \
  "--dbpath", "/data/flowdb", \
  "--skip-tx-validation", \
  "--chain-id", "mainnet", \
  "--rest-port", "8888", \
  "--port", "3569", \
  "--block-time", "0", \
  "-v" \
]
