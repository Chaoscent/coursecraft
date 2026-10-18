# SPDX-License-Identifier: Apache-2.0
# Multi-stage build for both runtime images:
#   docker build -f docker/Dockerfile --target app .
#   docker build -f docker/Dockerfile --target converter .

ARG NODE_IMAGE=node:24-trixie-slim

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
WORKDIR /src
COPY package.json ./
RUN npm install -g --ignore-scripts "$(node -p "require('./package.json').packageManager")"
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/converter/package.json apps/converter/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/
COPY packages/course-model/package.json packages/course-model/
COPY packages/player/package.json packages/player/
COPY packages/eslint-config/package.json packages/eslint-config/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @coursecraft/server --filter @coursecraft/converter --filter @coursecraft/web --filter @coursecraft/player run build \
 && pnpm --filter @coursecraft/server deploy --prod /out/app \
 && pnpm --filter @coursecraft/converter deploy --prod /out/converter \
 && mkdir -p /out/app/public /out/app/player \
 && cp -r apps/web/dist/. /out/app/public/ \
 && cp -r packages/player/dist/. /out/app/player/

# --- app: API, web UI, content host -------------------------------------------
# Runtime images keep only node itself; npm and corepack are removed (not needed,
# and their bundled dependencies would add attack surface).
FROM ${NODE_IMAGE} AS app
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-17 \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
 && groupadd --gid 10000 coursecraft-work \
 && useradd --uid 10001 --gid 10000 --no-create-home --shell /usr/sbin/nologin coursecraft \
 && mkdir -p /data /work /run/coursecraft \
 && chown 10001:10000 /data && chown 10001:10000 /work && chmod 2770 /work
COPY --from=build /out/app /app
COPY docker/coursecraft.sh /usr/local/bin/coursecraft
ENV NODE_ENV=production COURSECRAFT_DATA_DIR=/data COURSECRAFT_WEB_DIR=/app/public COURSECRAFT_PLAYER_DIR=/app/player
USER 10001:10000
WORKDIR /app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 CMD ["node", "/app/dist/healthcheck.js"]
CMD ["node", "/app/dist/main.js"]

# --- converter: untrusted documents and media --------------------------------
FROM ${NODE_IMAGE} AS converter
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-impress-nogui ffmpeg \
      fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
 && groupadd --gid 10000 coursecraft-work \
 && useradd --uid 10002 --gid 10000 --no-create-home --shell /usr/sbin/nologin converter \
 && mkdir -p /work && chown 10002:10000 /work && chmod 2770 /work
COPY --from=build /out/converter /converter
ENV NODE_ENV=production COURSECRAFT_WORK_DIR=/work HOME=/tmp
USER 10002:10000
WORKDIR /converter
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD ["node", "/converter/dist/healthcheck.js"]
CMD ["node", "/converter/dist/main.js"]
