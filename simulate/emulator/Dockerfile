# Build optimized emulator from Outblock fork
# Features: safer fork-mode register fetching, cache-poisoning fix, watchdog recovery
FROM golang:1.25-bookworm AS builder

# Pin the emulator revision so CI builds are reproducible and cache-busted when the ref changes.
ARG EMULATOR_REF=main

RUN git clone https://github.com/Outblock/flow-emulator.git /src \
  && cd /src \
  && git checkout "$EMULATOR_REF"
WORKDIR /src

# Fix: clear the in-memory globalCache on snapshot revert so fork-mode
# registers fetched during a simulation don't leak into subsequent requests.
# Without this, the 3-tier cache (globalCache → SQLite → gRPC) returns stale
# post-transaction values from the LRU after snapshot revert restores SQLite.
RUN printf '\n// LoadSnapshot overrides sqlite.Store.LoadSnapshot to also purge\n\
// the in-memory globalCache. Without this, registers fetched from mainnet\n\
// during a simulation persist through snapshot revert.\n\
func (s *Store) LoadSnapshot(name string) error {\n\
\terr := s.Store.LoadSnapshot(name)\n\
\tif err != nil {\n\
\t\treturn err\n\
\t}\n\
\ts.globalCache.Purge()\n\
\treturn nil\n\
}\n' >> storage/remote/store.go

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
