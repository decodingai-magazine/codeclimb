// The live registry: experiment or evaluation id → abort, in the Agent Server's one process (spec: Crash and resume).
// Every graph of the server shares this module instance, so the stop graph aborts a night's work directly.

interface Entry {
	night: string;
	abort: (reason: Error) => void;
}

const live = new Map<string, Entry>();

export function register(id: string, night: string, abort: (reason: Error) => void): () => void {
	const entry = { night, abort };
	live.set(id, entry);
	return () => {
		if (live.get(id) === entry) live.delete(id);
	};
}

/** Abort every live entry of a night; returns how many. */
export function abortNight(night: string, reason: Error): number {
	let n = 0;
	for (const [id, entry] of live) {
		if (entry.night !== night) continue;
		live.delete(id);
		entry.abort(reason);
		n++;
	}
	return n;
}
