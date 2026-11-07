// Live Pi sessions in this worker, so a night stop or a cancelled run can
// abort() them. Inngest cancel never interrupts a running step; without this,
// Pi keeps spending tokens against destroyed sandboxes.

interface Live {
  nightId: string;
  abort: () => Promise<void>;
}

const live = new Map<string, Live>();

/** Register a running session under its Inngest run id. Returns the unregister function. */
export function registerLive(runId: string, nightId: string, abort: () => Promise<void>): () => void {
  live.set(runId, { nightId, abort });
  return () => {
    if (live.get(runId)?.abort === abort) live.delete(runId);
  };
}

export async function abortRun(runId: string): Promise<number> {
  const entry = live.get(runId);
  if (!entry) return 0;
  await entry.abort().catch(() => undefined);
  return 1;
}

export async function abortNight(nightId: string): Promise<number> {
  const hits = [...live.values()].filter((l) => l.nightId === nightId);
  await Promise.all(hits.map((l) => l.abort().catch(() => undefined)));
  return hits.length;
}
