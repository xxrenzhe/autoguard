# AutoGuard Dockerfile
# Multi-stage build for production deployment

# ============================================================
# Stage 1: Build stage
# ============================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/cloak/package.json ./packages/cloak/
COPY packages/page-generator/package.json ./packages/page-generator/
COPY packages/web/package.json ./packages/web/
COPY workers/cloak-worker/package.json ./workers/cloak-worker/
COPY workers/log-writer/package.json ./workers/log-writer/
COPY workers/scheduler/package.json ./workers/scheduler/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build all packages
RUN pnpm run build

# Build Next.js web dashboard
WORKDIR /app/packages/web
RUN pnpm run build

# ============================================================
# Stage 2: Production stage
# ============================================================
FROM node:20-alpine AS production

# Install system dependencies
RUN apk add --no-cache \
    nginx \
    supervisor \
    redis \
    curl \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set Playwright environment
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Copy package files and install production dependencies
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/cloak/package.json ./packages/cloak/
COPY packages/page-generator/package.json ./packages/page-generator/
COPY packages/web/package.json ./packages/web/
COPY workers/cloak-worker/package.json ./workers/cloak-worker/
COPY workers/log-writer/package.json ./workers/log-writer/
COPY workers/scheduler/package.json ./workers/scheduler/

RUN pnpm install --frozen-lockfile --prod

# Copy built files from builder
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/cloak/dist ./packages/cloak/dist
COPY --from=builder /app/packages/page-generator/dist ./packages/page-generator/dist
COPY --from=builder /app/packages/web/.next ./packages/web/.next
COPY --from=builder /app/packages/web/public ./packages/web/public
COPY --from=builder /app/workers/cloak-worker/dist ./workers/cloak-worker/dist
COPY --from=builder /app/workers/log-writer/dist ./workers/log-writer/dist
COPY --from=builder /app/workers/scheduler/dist ./workers/scheduler/dist

# Copy configuration files
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/supervisord/supervisord.conf /etc/supervisord.conf

# Create necessary directories
RUN mkdir -p /data/pages /data/db /var/log/autoguard /run/nginx

# Create non-root user
RUN addgroup -g 1001 -S autoguard && \
    adduser -S autoguard -u 1001 -G autoguard

# Set permissions
RUN chown -R autoguard:autoguard /app /data /var/log/autoguard
RUN chown -R autoguard:autoguard /var/lib/nginx /var/log/nginx /run/nginx

# Expose port (only 80, Cloudflare handles TLS)
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost/health || exit 1

# Start supervisord
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
