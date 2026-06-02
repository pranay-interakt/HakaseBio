# syntax=docker/dockerfile:1.7
# ───────────────────────────────────────────────────────────────────
# Hakase BioTwin — Frontend (Node 20 builder → nginx runtime)
# ───────────────────────────────────────────────────────────────────
FROM node:20-bookworm AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY artifacts/ ./artifacts/
COPY lib/ ./lib/
COPY scripts/ ./scripts/
COPY frontend/ ./frontend/
ARG VITE_API_BASE_URL
ARG VITE_AI_SERVICE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_AI_SERVICE_URL=${VITE_AI_SERVICE_URL}
RUN pnpm install --frozen-lockfile=false --prefer-offline
RUN pnpm --filter @workspace/hakase-ai run build

# ── runtime ─────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime
COPY frontend/nginx/static-only.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/artifacts/hakase-ai/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
