# AIRNMS BFF (Node/TypeScript) — rootless-Podman deployment image (Task A).
# Multi-stage: build @nms/shared + @nms/bff from the workspace, then ship a lean runtime image
# running as the non-root `node` user. NO secrets are baked in — all config is injected at runtime
# via the quadlet EnvironmentFile (~/nms/.env.bff, 0600). Pinned base BY DIGEST (docker-infra rule).
#
# Build context = repo root:  podman build -f deploy/librenms-podman/bff.Dockerfile -t localhost/nms-bff:0.1.0 .
FROM docker.io/library/node@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS builder
WORKDIR /app
# Copy manifests first for layer caching, then the sources.
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY scripts ./scripts
COPY packages/shared/package.json ./packages/shared/
COPY packages/bff/package.json ./packages/bff/
COPY packages/web/package.json ./packages/web/
RUN npm ci
COPY packages/shared ./packages/shared
COPY packages/bff ./packages/bff
# Build only the shared lib + the BFF (composite project references resolve shared automatically).
RUN npm run build --workspace @nms/shared \
 && npm run build --workspace @nms/bff \
 # Drop dev dependencies for the runtime image.
 && npm prune --omit=dev

FROM docker.io/library/node@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Copy the pruned production install + compiled output only.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/bff/package.json ./packages/bff/package.json
COPY --from=builder /app/packages/bff/dist ./packages/bff/dist
# Non-root (docker-infra rule: never run as root). The stock `node` user (uid 1000) ships in the base.
USER node
EXPOSE 4000
# Liveness — the BFF exposes /health (no dependency calls).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||4000) +'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/bff/dist/index.js"]
