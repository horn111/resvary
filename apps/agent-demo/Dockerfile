# syntax=docker/dockerfile:1.7
# Apply Debian's OpenSSL security updates while the distroless image catches up.
FROM debian:trixie-slim AS openssl-security
WORKDIR /tmp/openssl-security
RUN apt-get update \
    && apt-get download libssl3t64 \
    && dpkg --compare-versions "$(dpkg-deb --field libssl3t64_*.deb Version)" ge '3.5.7-1~deb13u3' \
    && dpkg-deb --extract libssl3t64_*.deb /patched \
    && dpkg-deb --control libssl3t64_*.deb /control \
    && mkdir -p /patched/var/lib/dpkg/status.d \
    && cp /control/control /patched/var/lib/dpkg/status.d/libssl3t64 \
    && cp /control/md5sums /patched/var/lib/dpkg/status.d/libssl3t64.md5sums

FROM node:24-bookworm-slim AS build
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/sqlite/package.json packages/sqlite/package.json
COPY packages/postgres/package.json packages/postgres/package.json
COPY packages/circle/package.json packages/circle/package.json
COPY packages/worker/package.json packages/worker/package.json
COPY packages/create-resvary/package.json packages/create-resvary/package.json
COPY apps/demo/package.json apps/demo/package.json
COPY apps/console/package.json apps/console/package.json
COPY apps/agent-demo/package.json apps/agent-demo/package.json
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:core && npm run build --workspace @resvary/agent-demo
RUN npm prune --omit=dev --ignore-scripts
# npm retains TypeScript through Solana/Workflow peers and Playwright through
# Next's optional test peer. The server and tsx worker need neither toolchain.
RUN rm -rf node_modules/typescript node_modules/@typescript \
      node_modules/@playwright node_modules/playwright node_modules/playwright-core \
    && rm -f node_modules/.bin/tsc node_modules/.bin/tsserver \
      node_modules/.bin/playwright node_modules/.bin/playwright-core
RUN mkdir -p /home/nonroot/.circle-cli \
    && chown -R 65532:65532 /home/nonroot \
    && chmod 700 /home/nonroot/.circle-cli

FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime
COPY --from=openssl-security /patched/ /
WORKDIR /workspace
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOME=/home/nonroot
COPY --from=build --chown=65532:65532 /workspace/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /workspace/packages ./packages
COPY --from=build --chown=65532:65532 /workspace/apps/agent-demo ./apps/agent-demo
COPY --from=build --chown=65532:65532 /workspace/package.json ./package.json
COPY --from=build --chown=65532:65532 /home/nonroot/.circle-cli /home/nonroot/.circle-cli
USER 65532:65532
WORKDIR /workspace/apps/agent-demo
EXPOSE 3100
CMD ["../../node_modules/next/dist/bin/next", "start", "--port", "3100", "--hostname", "0.0.0.0"]
