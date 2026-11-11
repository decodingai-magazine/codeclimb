// Load `.env` into process.env; values already in the shell win (spec: Deployment and environment).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

export function loadEnvFile(dir: string): void {
	const file = join(dir, ".env");
	if (!existsSync(file)) return;
	for (const [k, v] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
		if (process.env[k] === undefined) process.env[k] = v;
	}
}
