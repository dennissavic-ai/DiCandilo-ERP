# ── Build stage ───────────────────────────────────────────────────────────────
# Build context must be the monorepo root so we have access to the workspace
# package-lock.json and shared packages.
FROM node:20-alpine AS builder
WORKDIR /app

# openssl required so Prisma generates the correct engine binary
RUN apk add --no-cache openssl

# Copy workspace manifests first for better layer caching
COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY apps/api/package.json ./apps/api/
COPY apps/api/prisma ./apps/api/prisma/

# Install all deps (dev deps required: prisma CLI, tsx, tsc)
RUN npm ci && npm cache clean --force

# Copy source (shared packages + api)
COPY packages/shared ./packages/shared/
COPY packages/ui ./packages/ui/
COPY apps/api ./apps/api/

WORKDIR /app/apps/api

# Generate Prisma client into root node_modules
RUN npx prisma generate

# Compile TypeScript
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Install dumb-init for signal handling + openssl for Prisma engine detection
RUN apk add --no-cache dumb-init openssl

# Non-root user (created before COPY so we can use --chown)
RUN addgroup --system --gid 1001 erp && \
    adduser --system --uid 1001 --ingroup erp erp

# Copy node_modules (includes generated Prisma client & workspace symlinks)
COPY --chown=erp:erp --from=builder /app/node_modules ./node_modules

# Copy shared packages (needed at runtime via workspace symlink resolution)
COPY --chown=erp:erp --from=builder /app/packages/shared ./packages/shared
COPY --chown=erp:erp --from=builder /app/packages/ui ./packages/ui

# Copy compiled API
COPY --chown=erp:erp --from=builder /app/apps/api/dist ./apps/api/dist
COPY --chown=erp:erp --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --chown=erp:erp --from=builder /app/apps/api/package.json ./apps/api/

USER erp

EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/app.js"]
