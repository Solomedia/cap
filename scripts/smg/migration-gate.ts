import { parseArgs } from "node:util";
import { $ } from "bun";
import { migrationGate } from "./lib/migration-gate.ts";

const { values } = parseArgs({ options: { base: { type: "string" } } });
if (!values.base) {
	console.error(
		"Usage: PR_LABELS='[\"a\"]' bun scripts/smg/migration-gate.ts --base <ref>",
	);
	process.exit(1);
}

const changedFiles = (
	await $`git diff --name-only ${values.base}...HEAD`.text()
)
	.split("\n")
	.filter(Boolean);
const labels = JSON.parse(process.env.PR_LABELS || "[]") as string[];
const gate = migrationGate({ changedFiles, labels });
console.log(gate.message);
process.exit(gate.ok ? 0 : 1);
