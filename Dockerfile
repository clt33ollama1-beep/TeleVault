# Stage 1: Install dependencies & build static frontend
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Native build toolchain for better-sqlite3 if prebuilt binary isn't matched
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

# Stage 2: Production runtime
FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3080

# sqlite3 CLI for hot backups/maintenance & curl for container healthchecks
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl sqlite3 && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src/server ./src/server
COPY --from=builder /app/src/types.ts ./src/types.ts

RUN mkdir -p /app/data/media && chown -R node:node /app

USER node
EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:3080/api/health || exit 1

CMD ["npm", "start"]
