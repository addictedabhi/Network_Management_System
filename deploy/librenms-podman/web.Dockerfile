# AIRNMS custom UI (Next.js) — rootless-Podman deployment image (Task A).
# Multi-stage: build @nms/shared + @nms/web, then ship a runtime image that runs `next start` as the
# non-root `node` user. NO secrets are baked in. The ONLY server-side runtime value is BFF_ORIGIN
# (the in-network BFF URL), injected via the quadlet — it is NOT NEXT_PUBLIC_ and never reaches the
# browser (the browser only ever calls same-origin /bff/*). basePath is baked at build time (/app).
# Pinned base BY DIGEST. Build context = repo root:
#   podman build -f deploy/librenms-podman/web.Dockerfile -t localhost/nms-web:0.1.0 .
FROM docker.io/library/node@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY scripts ./scripts
COPY packages/shared/package.json ./packages/shared/
COPY packages/bff/package.json ./packages/bff/
COPY packages/web/package.json ./packages/web/
RUN npm ci
COPY packages/shared ./packages/shared
COPY packages/web ./packages/web
# Served under the gateway subpath /app (matches the nginx location block + Next basePath).
# NEXT_PUBLIC_BASE_PATH is baked into the client bundle for the logo <img> prefix. It is a PATH,
# not a secret — safe to expose to the browser (it is literally the public URL prefix).
ENV BASE_PATH=/app
ENV NEXT_PUBLIC_BASE_PATH=/app
RUN npm run build --workspace @nms/shared \
 && npm run build --workspace @nms/web

FROM docker.io/library/node@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# `next start` needs node_modules, the built .next, public assets, and the config.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/web ./packages/web
USER node
WORKDIR /app/packages/web
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/app/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# `next start` honours the baked basePath; -p 3000 matches the package script.
CMD ["npm", "run", "start"]
