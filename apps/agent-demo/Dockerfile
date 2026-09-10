# syntax=docker/dockerfile:1.7
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

FROM node:24-bookworm-slim AS runtime
WORKDIR /workspace
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOME=/home/node
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/packages ./packages
COPY --from=build --chown=node:node /workspace/apps/agent-demo ./apps/agent-demo
COPY --from=build --chown=node:node /workspace/package.json ./package.json
RUN mkdir -p /home/node/.circle-cli && chown node:node /home/node/.circle-cli && chmod 700 /home/node/.circle-cli
USER node
WORKDIR /workspace/apps/agent-demo
EXPOSE 3100
CMD ["node", "../../node_modules/next/dist/bin/next", "start", "--port", "3100", "--hostname", "0.0.0.0"]
