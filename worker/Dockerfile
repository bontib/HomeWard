# syntax=docker/dockerfile:1
# HomeWard worker. Build context: the worker/ folder.
# Rust is cross-compiled on the build machine with cargo-zigbuild (no QEMU), static musl.

FROM --platform=$BUILDPLATFORM rust:1-alpine AS build
ARG TARGETARCH
RUN apk add --no-cache musl-dev zig \
 && cargo install --locked cargo-zigbuild
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN case "$TARGETARCH" in \
      amd64) T=x86_64-unknown-linux-musl ;; \
      arm64) T=aarch64-unknown-linux-musl ;; \
      *) echo "unsupported architecture $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && rustup target add "$T" \
 && cargo zigbuild --release --locked --target "$T" \
 && cp "target/$T/release/worker" /worker

FROM aquasec/trivy:0.76.1 AS trivy

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata \
 && adduser -D -u 10001 worker \
 && mkdir -p /var/cache/trivy && chown worker /var/cache/trivy
COPY --from=trivy /usr/local/bin/trivy /usr/local/bin/trivy
COPY --from=build /worker /app/worker
USER 10001
ENV TRIVY_PATH=/usr/local/bin/trivy TRIVY_CACHE_DIR=/var/cache/trivy
VOLUME /var/cache/trivy
ENTRYPOINT ["/app/worker"]
