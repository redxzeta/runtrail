# syntax=docker/dockerfile:1.7

FROM node:22.13.1-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@11.5.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build \
  && pnpm prune --prod

FROM node:22.13.1-bookworm-slim AS runtime

ENV NODE_ENV=production \
  RUNTRAIL_CONFIG=/app/config/runtrail.example.yaml \
  RUNTRAIL_HOST=0.0.0.0 \
  RUNTRAIL_PORT=8787 \
  RUNTRAIL_DB_PATH=/app/data/runtrail.sqlite \
  RUNTRAIL_LOG_DIR=/app/data/logs

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/config ./config

RUN mkdir -p /app/data/logs \
  && chown -R node:node /app/data

USER node
EXPOSE 8787

CMD ["node", "dist/index.js"]
