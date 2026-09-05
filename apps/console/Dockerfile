# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/console/package.json apps/console/package.json
COPY apps/demo/package.json apps/demo/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/sqlite/package.json packages/sqlite/package.json
COPY packages/postgres/package.json packages/postgres/package.json
COPY packages/circle/package.json packages/circle/package.json
COPY packages/worker/package.json packages/worker/package.json
COPY packages/create-resvary/package.json packages/create-resvary/package.json
RUN npm ci --ignore-scripts

FROM node:24-bookworm-slim AS builder
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /workspace/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=@resvary/console

FROM node:24-bookworm-slim AS runner
WORKDIR /app/apps/console
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# Apply Debian security updates even when the upstream Node image has not been rebuilt yet.
# The runtime starts the standalone server directly and does not need the npm toolchain.
RUN apt-get update \
    && apt-get upgrade --yes \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    && groupadd --system --gid 1001 resvary \
    && useradd --system --uid 1001 --gid resvary console
COPY --from=builder --chown=console:resvary /workspace/apps/console/.next/standalone /app
COPY --from=builder --chown=console:resvary /workspace/apps/console/.next/static ./.next/static
COPY --from=builder --chown=console:resvary /workspace/packages/postgres/package.json /app/node_modules/@resvary/postgres/package.json
COPY --from=builder --chown=console:resvary /workspace/packages/postgres/dist /app/node_modules/@resvary/postgres/dist
COPY --from=builder --chown=console:resvary /workspace/packages/sdk/package.json /app/node_modules/@resvary/sdk/package.json
COPY --from=builder --chown=console:resvary /workspace/packages/sdk/dist /app/node_modules/@resvary/sdk/dist
USER console
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health',{headers:{authorization:'Bearer '+process.env.RESVARY_CONSOLE_ADMIN_SECRET}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
