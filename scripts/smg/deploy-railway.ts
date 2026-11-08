import { parseArgs } from "node:util";
import { parseFreeze } from "./lib/freeze.ts";
import { deployImage, waitForDeployment } from "./lib/railway.ts";

const fail = (message: string): never => {
	console.error(message);
	process.exit(1);
};

const { values } = parseArgs({ options: { image: { type: "string" } } });
const image =
	values.image ??
	fail("Usage: bun scripts/smg/deploy-railway.ts --image <ref@sha256:…>");
if (!image.includes("@sha256:"))
	fail(`Image must be pinned by digest (…@sha256:…), got ${image}`);

if (parseFreeze(process.env.SMG_DEPLOY_FREEZE)) {
	console.log(
		`Deploy frozen (SMG_DEPLOY_FREEZE). Built ${image}, not deployed.`,
	);
	process.exit(0);
}

const env = (name: string) => process.env[name] || fail(`Missing ${name}`);
const token = env("RAILWAY_TOKEN");
const projectId = env("RAILWAY_PROJECT_ID");
const environmentId = env("RAILWAY_ENVIRONMENT_ID");
const serviceId = env("RAILWAY_CAP_WEB_SERVICE_ID");
const healthUrl = env("HEALTH_URL");

const { deploymentId } = await deployImage({
	token,
	projectId,
	environmentId,
	serviceId,
	image,
});
console.log(`Deploying ${image} (deployment ${deploymentId})`);
const status = await waitForDeployment({
	token,
	deploymentId,
	healthUrl,
	timeoutMs: 20 * 60_000,
});
if (status !== "success")
	fail(`Deployment ${deploymentId} did not become healthy`);
console.log(`Deployed ${image}; ${healthUrl} answers 200`);
