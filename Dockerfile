# Compass: production image. Build it on the server that runs it (e.g. the DGX), so Prisma's
# database engine matches that machine's CPU (x86_64 DGX A100/H100, or ARM64 DGX Spark/GH200).
#
#   docker compose build && docker compose up -d
#
# The app needs no GPU. Data lives in the "compass-data" volume (SQLite at /data/compass.db).

FROM node:22-bookworm-slim

# Prisma needs OpenSSL; ca-certificates for any outbound HTTPS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# pnpm at the exact version pinned in package.json ("packageManager").
RUN corepack enable

# Dependencies first, so code changes don't reinstall everything.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/domain/package.json packages/domain/
COPY packages/physics/package.json packages/physics/
COPY packages/solver/package.json packages/solver/
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL="file:/data/compass.db"
VOLUME ["/data"]
EXPOSE 3000

# Apply any new database migrations, then start. Safe to run on every start.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec next start -H 0.0.0.0 -p ${PORT}"]
