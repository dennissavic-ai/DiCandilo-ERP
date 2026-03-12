# ── Build stage ───────────────────────────────────────────────────────────────
# Build context must be the monorepo root so we have access to the workspace
# package-lock.json and shared packages.
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace manifests first for better layer caching
COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY apps/web/package.json ./apps/web/
COPY apps/desktop/package.json ./apps/desktop/

# Skip electron binary download — desktop app is not built here
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci && npm cache clean --force

# Copy source (shared packages + web app)
COPY packages/shared ./packages/shared/
COPY packages/ui ./packages/ui/
COPY apps/web ./apps/web/

WORKDIR /app/apps/web
RUN npm run build

# ── Runtime stage (nginx) ─────────────────────────────────────────────────────
FROM nginx:alpine AS runner

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
