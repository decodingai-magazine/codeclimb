# 34: App: the nights list and a live night with its controls

**What to build:** A Next.js app on loopback, one client of the worker API, lists every night and shows one night live: its status and controls (stop while it runs, resume while paused, continue once it ended) and the current experiment.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Worker API and app), "Services", "Worker API", "Environment", "Given inputs and tools"

**Blocked by:** 32 (Worker API: read nights, stop, resume, continue)

**Status:** ready-for-agent

- [ ] `npm run dev`, `npm run build` and `npm run start` run the Next.js app bound to loopback, beside a running worker and dev server without taking their addresses; `npm run build` succeeds
- [ ] The app reaches the worker at `CODECLIMB_WORKER_URL`, with `CODECLIMB_WORKER_TOKEN` as its bearer when set (test with a fake worker)
- [ ] The home page lists every night with its status, read from the worker API, and stays current while nights run
- [ ] A night's page shows its status live; Stop, Resume and Continue (direction, rounds) call the worker API and appear only when they apply
- [ ] The current experiment is shown live
- [ ] Check against mock nights on the dev server: the list shows each finished night as `finished`; Stop on a running night ends it and its page shows `stopped`; Continue adds a round to a finished night
