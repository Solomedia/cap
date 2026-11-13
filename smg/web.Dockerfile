# Generated from apps/web/Dockerfile for Railway: no syntax directive, Railway cache mount ids, GeoIP database.
# Do not edit. Regenerate with: bun scripts/smg/railway-dockerfile.ts --write

FROM oven/bun:1.4.4-alpine AS bun

FROM node:24.22.1-alpine AS base

FROM base AS builder
WORKDIR /app
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY . .

RUN --mount=type=cache,id=s/3035d845-1a7e-43c5-8c15-c61db41ff384-/root/.bun/install/cache,target=/root/.bun/install/cache bun install --frozen-lockfile

ARG NEXT_PUBLIC_DOCKER_BUILD=true
ENV NEXT_PUBLIC_WEB_URL=http://localhost:3000

RUN bun run build:web


# 3. Production image, copy all the files and run next
# GeoIP database for view locations (DB-IP City Lite, CC BY 4.0, https://db-ip.com)
FROM base AS geoip
ARG RAILWAY_GIT_COMMIT_SHA
RUN mkdir -p /geoip && cd /geoip && \
	for month in "$(date -u +%Y-%m)" "$(date -u -d "@$(( $(date -u +%s) - 2678400 ))" +%Y-%m)"; do \
		if wget -q -O db.mmdb.gz "https://download.db-ip.com/free/dbip-city-lite-$month.mmdb.gz" && gunzip -f db.mmdb.gz; then \
			mv db.mmdb dbip-city-lite.mmdb && echo "GeoIP: DB-IP City Lite $month (commit ${RAILWAY_GIT_COMMIT_SHA:-unknown})" && break; \
		fi; \
		rm -f db.mmdb.gz db.mmdb; \
	done; \
	[ -f dbip-city-lite.mmdb ] || echo "GeoIP: download failed, views will have no location"

FROM base AS runner
WORKDIR /app

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001


# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/packages/database/migrations ./apps/web/migrations


COPY --from=geoip --chown=nextjs:nodejs /geoip /app/geoip
ENV CAP_GEOIP_DATABASE_PATH=/app/geoip/dbip-city-lite.mmdb

USER nextjs

EXPOSE 3000

CMD HOSTNAME="0.0.0.0" node apps/web/server.js
