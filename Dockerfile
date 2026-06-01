# ─────────────────────────────────────────────
# Stage 1 — Build TypeScript
# ─────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src/ src/
COPY tsconfig.json ./
RUN npx tsc

# ─────────────────────────────────────────────
# Stage 2 — Production runtime
# ─────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output and seed script
COPY --from=build /app/dist/ dist/
COPY scripts/ scripts/

# Drop privileges
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthz || exit 1

CMD ["node", "dist/index.js"]
