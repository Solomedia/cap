// Railway only accepts BuildKit cache mounts whose id is `s/<service id>-<target>`,
// and rejects `# syntax=` directives (external Dockerfile frontends). Upstream's
// apps/web/Dockerfile has both, so Railway builds a generated copy
// (smg/web.Dockerfile) instead of us patching upstream's file.

export const CAP_WEB_SERVICE_ID = "3035d845-1a7e-43c5-8c15-c61db41ff384";

const HEADER = `# Generated from apps/web/Dockerfile for Railway: no syntax directive, Railway cache mount ids, GeoIP database.
# Do not edit. Regenerate with: bun scripts/smg/railway-dockerfile.ts --write
`;

function railwayMount(options: string, serviceId: string): string {
	const parts = options.split(",").filter((part) => !part.startsWith("id="));
	const target = parts
		.find((part) => part.startsWith("target="))
		?.slice("target=".length);
	if (!target) throw new Error(`cache mount without a target: ${options}`);
	const rest = parts.filter((part) => part !== "type=cache");
	return ["type=cache", `id=s/${serviceId}-${target}`, ...rest].join(",");
}

export function railwayDockerfile(
	upstream: string,
	serviceId = CAP_WEB_SERVICE_ID,
): string {
	const body = upstream.replace(
		/--mount=(type=cache[^\s]*)/g,
		(_, options: string) => `--mount=${railwayMount(options, serviceId)}`,
	);
	const withoutSyntax = body.replace(/^# syntax=[^\n]*\n/, "");
	return `${HEADER}${withoutSyntax}`;
}

// Views get their country and city from this file (CAP_GEOIP_DATABASE_PATH),
// since Railway sends no location headers. DB-IP publishes the free City Lite
// database monthly under CC BY 4.0; the commit SHA busts the build cache so
// every deploy takes the current month. A failed download never fails the
// build: views just keep no location until the next deploy.
const GEOIP_DIR = "/app/geoip";
export const GEOIP_DATABASE_PATH = `${GEOIP_DIR}/dbip-city-lite.mmdb`;

const GEOIP_STAGE = `# GeoIP database for view locations (DB-IP City Lite, CC BY 4.0, https://db-ip.com)
FROM base AS geoip
ARG RAILWAY_GIT_COMMIT_SHA
RUN mkdir -p /geoip && cd /geoip && \\
	for month in "$(date -u +%Y-%m)" "$(date -u -d "@$(( $(date -u +%s) - 2678400 ))" +%Y-%m)"; do \\
		if wget -q -O db.mmdb.gz "https://download.db-ip.com/free/dbip-city-lite-$month.mmdb.gz" && gunzip -f db.mmdb.gz; then \\
			mv db.mmdb dbip-city-lite.mmdb && echo "GeoIP: DB-IP City Lite $month (commit \${RAILWAY_GIT_COMMIT_SHA:-unknown})" && break; \\
		fi; \\
		rm -f db.mmdb.gz db.mmdb; \\
	done; \\
	[ -f dbip-city-lite.mmdb ] || echo "GeoIP: download failed, views will have no location"

`;

const GEOIP_COPY = `COPY --from=geoip --chown=nextjs:nodejs /geoip ${GEOIP_DIR}
ENV CAP_GEOIP_DATABASE_PATH=${GEOIP_DATABASE_PATH}

`;

function insertBefore(text: string, anchor: string, insert: string): string {
	const index = text.indexOf(anchor);
	if (index === -1 || text.indexOf(anchor, index + 1) !== -1) {
		throw new Error(
			`expected exactly one "${anchor}" in apps/web/Dockerfile; update scripts/smg/lib/railway-dockerfile.ts`,
		);
	}
	return text.slice(0, index) + insert + text.slice(index);
}

export function withGeoIpDatabase(dockerfile: string): string {
	const withStage = insertBefore(
		dockerfile,
		"FROM base AS runner",
		GEOIP_STAGE,
	);
	return insertBefore(withStage, "USER nextjs", GEOIP_COPY);
}

export function smgWebDockerfile(
	upstream: string,
	serviceId = CAP_WEB_SERVICE_ID,
): string {
	return withGeoIpDatabase(railwayDockerfile(upstream, serviceId));
}
