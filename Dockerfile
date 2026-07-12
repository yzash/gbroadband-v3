# Optional container path for Render (or any host). The render.yaml above uses
# the native Node runtime; this Dockerfile is provided for parity / other hosts.
FROM node:22-bookworm-slim AS base
# better-sqlite3 compiles a native addon at install time.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS run
ENV NODE_ENV=production
ENV SDAL_DB_PATH=/var/data/sdal.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json
# Persistent disk gets mounted at /var/data by the host.
VOLUME ["/var/data"]
EXPOSE 3000
# Seed on first boot if the DB is missing, then start.
CMD ["sh", "-c", "test -f \"$SDAL_DB_PATH\" || npm run seed; npm run start"]
