// The one sandbox backend of the Agent Server process. It refuses a night that has a stop.json (spec: Sandboxes).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DockerBackend } from "../sandbox/docker.ts";
import { findNightDir } from "./files.ts";
import { serverRoot } from "./types.ts";

export const sandboxes = new DockerBackend({
	refuseNight: (night) => {
		const dir = findNightDir(serverRoot(), night);
		return dir !== null && existsSync(join(dir, "stop.json"));
	},
});
