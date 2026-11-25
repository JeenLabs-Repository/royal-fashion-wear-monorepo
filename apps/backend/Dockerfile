# Backend production image. Built in CI (or on the compute engine), never on
# the live server; running the image builds nothing.
# Every Node stage uses the exact tag node:22.23.4-bookworm-slim.

FROM node:22.23.4-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV GORGO_DISABLE_TELEMETRY=true
ENV MEDUSA_DISABLE_TELEMETRY=true
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate
WORKDIR /app

# The production environment is deliberately not set in this stage or the next
# two, so `medusa build` needs no secrets.
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/storefront/package.json apps/storefront/package.json
COPY apps/vendor-portal/package.json apps/vendor-portal/package.json
# pnpm 12 ignores dependency build scripts unless allowed; a clean image has no
# user allowlist, so the install must opt in (local machines often set this in
# ~/.config/pnpm). Needed for @swc/core, esbuild and similar native packages.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --config.dangerouslyAllowAllBuilds=true \
    --store-dir /pnpm/store --filter @dtc/gorgo-medusa-backend...
COPY apps/backend apps/backend
RUN pnpm --filter @dtc/gorgo-medusa-backend run build

# The vendor portal is a static build that the backend serves under
# /vendor-portal/. It is built here, never on the live server.
FROM base AS portal-build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/storefront/package.json apps/storefront/package.json
COPY apps/vendor-portal/package.json apps/vendor-portal/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --config.dangerouslyAllowAllBuilds=true \
    --store-dir /pnpm/store --filter @dtc/vendor-portal...
COPY apps/vendor-portal apps/vendor-portal
RUN pnpm --filter @dtc/vendor-portal run build

# Pruned production dependencies from the committed lockfile.
FROM build AS prod-deps
RUN pnpm --filter @dtc/gorgo-medusa-backend deploy --prod --legacy \
    --config.dangerouslyAllowAllBuilds=true /prod/backend

FROM node:22.23.4-bookworm-slim AS runtime
ENV GORGO_DISABLE_TELEMETRY=true
ENV MEDUSA_DISABLE_TELEMETRY=true
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /prod/backend/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/apps/backend/.medusa/server /app/.medusa/server
COPY --chown=node:node apps/backend/docker-entrypoint.sh /app/docker-entrypoint.sh
COPY --from=portal-build --chown=node:node /app/apps/vendor-portal/dist /app/static/vendor-portal
ENV VENDOR_PORTAL_DIR=/app/static/vendor-portal
RUN mkdir -p /app/.medusa/server/static && chown node:node /app/.medusa/server/static
USER node
EXPOSE 9000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["sh", "/app/docker-entrypoint.sh"]
