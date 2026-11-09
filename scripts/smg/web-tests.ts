import { parseArgs } from "node:util";
import { $ } from "bun";
import { webTestFiles } from "./lib/web-tests.ts";

const { values } = parseArgs({
	options: { base: { type: "string" }, head: { type: "string" } },
});
if (!values.base) {
	console.error("Usage: bun scripts/smg/web-tests.ts --base <ref>");
	process.exit(1);
}

const ciYaml = await Bun.file(".github/workflows/ci.yml").text();
const changedFiles = (
	await $`git diff --name-only ${values.base}...HEAD`.text()
)
	.split("\n")
	.filter(Boolean);

console.log(
	webTestFiles({ ciYaml, changedFiles, headRef: values.head }).join("\n"),
);
