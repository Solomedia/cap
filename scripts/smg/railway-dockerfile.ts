import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { smgWebDockerfile } from "./lib/railway-dockerfile.ts";

const { values } = parseArgs({
	options: { write: { type: "boolean", default: false } },
});
const out = smgWebDockerfile(readFileSync("apps/web/Dockerfile", "utf8"));
if (values.write) {
	writeFileSync("smg/web.Dockerfile", out);
	console.log("wrote smg/web.Dockerfile");
} else {
	process.stdout.write(out);
}
