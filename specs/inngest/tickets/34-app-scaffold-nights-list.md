# 34: App: scaffold, worker-API route, Nights list, Inngest scaffold

**What to build:** `npm run dev` opens an app whose home page lists every night with its status, round, best primary value against its threshold and spend against budget, refreshed every 10 seconds. The browser never talks to the worker: a server route forwards to the worker API and adds the token. The app is a separate application from the worker and also carries the small Inngest scaffold the spec fixes.

**Spec sections** (`specs/inngest/spec.md`): "App", "Worker API", "Deployment and environment", "What you get, what you build"

**Blocked by:** 32 (Worker API: read nights, stop, resume, continue)

**Status:** ready-for-agent

- [ ] `dev`, `build` and `start` run the Next.js app bound to `127.0.0.1`; `npm run build` succeeds; the worker's code (Pi, sandboxes) is not in the app's bundle
- [ ] Every page reads the worker through a server route that targets `CODECLIMB_WORKER_URL` and adds `CODECLIMB_WORKER_TOKEN`; the token never appears in what the browser receives (test on the route with a fake worker)
- [ ] `/` lists nights with status, round, best primary value against its threshold, spend against budget, and refreshes every 10 s; light and dark themes both render
- [ ] The Inngest scaffold exists apart from the worker: app id `codeclimb`, one `hello-world` function on `test/hello.world`, served at `/api/inngest`, sent by `POST /api/hello`; `inngest.json` points the dev server at `http://localhost:3000/api/inngest` with discovery off; `dev` sets `INNGEST_DEV=1`
- [ ] Check: with the worker serving a results directory left by the mock nights, the Nights page shows each finished night as `finished` with spend 0; verified by a rendered-page test or a browser check, with the worker down shown as a clear error instead of a crash
- [ ] Pure view-model functions (best primary against threshold, spend against budget) have unit tests
