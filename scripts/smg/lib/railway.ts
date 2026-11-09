// Railway public API, as documented at docs.railway.com/integrations/api.
// Project tokens use the Project-Access-Token header, not Authorization: Bearer.
const API_URL = "https://backboard.railway.com/graphql/v2";

export type DeployStatus = "pending" | "success" | "failed";

const FAILED = new Set(["FAILED", "CRASHED", "REMOVED", "SKIPPED"]);

export function interpretDeploymentStatus(status: string): DeployStatus {
	if (status === "SUCCESS") return "success";
	return FAILED.has(status) ? "failed" : "pending";
}

type Fetch = typeof fetch;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function gql<T>(
	fetchFn: Fetch,
	token: string,
	query: string,
	variables: Record<string, unknown>,
): Promise<T> {
	const response = await fetchFn(API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Project-Access-Token": token,
		},
		body: JSON.stringify({ query, variables }),
	});
	const json = (await response.json()) as {
		data?: T;
		errors?: { message: string }[];
	};
	if (json.errors?.length) {
		throw new Error(
			`Railway API: ${json.errors.map((e) => e.message).join("; ")}`,
		);
	}
	if (!response.ok || !json.data) {
		throw new Error(`Railway API: HTTP ${response.status}`);
	}
	return json.data;
}

const LATEST_DEPLOYMENTS = `query deployments($input: DeploymentListInput!) {
  deployments(input: $input, first: 5) { edges { node { id status } } }
}`;
const UPDATE_SOURCE = `mutation serviceInstanceUpdate($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
  serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
}`;
const DEPLOY = `mutation serviceInstanceDeploy($serviceId: String!, $environmentId: String!) {
  serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
}`;
const DEPLOYMENT = `query deployment($id: String!) {
  deployment(id: $id) { id status }
}`;

type DeploymentList = {
	deployments: { edges: { node: { id: string; status: string } }[] };
};

// serviceInstanceDeploy returns a Boolean, so the new deployment is the one
// that shows up in the list after the trigger.
export async function deployImage(input: {
	token: string;
	projectId: string;
	environmentId: string;
	serviceId: string;
	image: string;
	fetch?: Fetch;
	pollMs?: number;
	appearTimeoutMs?: number;
}): Promise<{ deploymentId: string }> {
	const fetchFn = input.fetch ?? fetch;
	const pollMs = input.pollMs ?? 5000;
	const listInput = {
		input: {
			projectId: input.projectId,
			environmentId: input.environmentId,
			serviceId: input.serviceId,
		},
	};
	const ids = async () =>
		(
			await gql<DeploymentList>(
				fetchFn,
				input.token,
				LATEST_DEPLOYMENTS,
				listInput,
			)
		).deployments.edges.map((edge) => edge.node.id);

	const before = new Set(await ids());
	const target = {
		serviceId: input.serviceId,
		environmentId: input.environmentId,
	};
	await gql(fetchFn, input.token, UPDATE_SOURCE, {
		...target,
		input: { source: { image: input.image } },
	});
	await gql(fetchFn, input.token, DEPLOY, target);

	const deadline = Date.now() + (input.appearTimeoutMs ?? 120_000);
	while (Date.now() <= deadline) {
		const fresh = (await ids()).find((id) => !before.has(id));
		if (fresh) return { deploymentId: fresh };
		await sleep(pollMs);
	}
	throw new Error("Railway API: the new deployment never appeared");
}

export async function waitForDeployment(input: {
	token: string;
	deploymentId: string;
	healthUrl: string;
	timeoutMs: number;
	fetch?: Fetch;
	pollMs?: number;
}): Promise<DeployStatus> {
	const fetchFn = input.fetch ?? fetch;
	const pollMs = input.pollMs ?? 10_000;
	const deadline = Date.now() + input.timeoutMs;
	while (Date.now() <= deadline) {
		const { deployment } = await gql<{ deployment: { status: string } }>(
			fetchFn,
			input.token,
			DEPLOYMENT,
			{
				id: input.deploymentId,
			},
		);
		const status = interpretDeploymentStatus(deployment.status);
		if (status === "failed") return "failed";
		if (status === "success") {
			const health = await fetchFn(input.healthUrl);
			return health.status === 200 ? "success" : "failed";
		}
		await sleep(pollMs);
	}
	return "failed";
}
