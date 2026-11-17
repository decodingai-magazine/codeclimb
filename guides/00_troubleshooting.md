# Troubleshooting

After this guide you can match a failure's error text to its cause and fix. Each entry: error text → cause → fix.

## Known failures

### `server: no .env in <root>: copy .env.example (the server needs LANGSMITH_API_KEY to boot)`

- **Cause:** `npm run server` found no `.env` in the checkout (`src/cli/server.ts`). A git worktree has none of its own.
- **Fix:** `cp .env.example .env` and set `LANGSMITH_API_KEY`, or in a worktree symlink the main checkout's `.env`.

### The server won't boot: the container exits with code 3

`npm run server` fails with `docker compose up failed (status <n>)` or `the server container stopped (exited 3)`, and `npm run server:logs` shows the boot check failing.

- **Cause:** the Agent Server exits with code 3 when `LANGSMITH_API_KEY` is missing, or when its region does not match `LANGSMITH_ENDPOINT` (a key used against the other region gets 403 with an empty message).
- **Fix:** set the key in `.env`; for an EU key set `LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com`. Then `npm run server` again.

### `server: docker compose up failed (status <n>); see the output above`

- **Cause:** the image build or `docker compose up` failed. With the stack already up, the old container would still answer `/ok`, so `server` fails instead of trusting it.
- **Fix:** read the build output above the line, fix it, run `npm run server` again.

### `server: no answer on http://127.0.0.1:8123/ok after 5 min; see npm run server:logs`

- **Cause:** the server container is up but its graphs did not load.
- **Fix:** read `npm run server:logs` for the failing import or env var.

### `server: the server's port is published beyond loopback (...); the stack was stopped`

- **Cause:** port 8123 was bound on more than `127.0.0.1`, so the stack was stopped rather than left open.
- **Fix:** run `npm run server` (not `langgraphjs up` by hand): its `docker` shim rewrites the binding to loopback.

### `run-night: cannot start the night on the Agent Server at http://127.0.0.1:8123 (is \`npm run server\` running?): ...`

- **Cause:** no Agent Server answers on `CODECLIMB_SERVER_URL`.
- **Fix:** `npm run server`, then check `curl -s http://127.0.0.1:8123/ok`.

### `run-night: night id <id> was used before (<dir>): pick another`

- **Cause:** `--night-id` names a night that already has a folder; a failed start also keeps its thread.
- **Fix:** pass a fresh `--night-id`, or omit it for a timestamped one.

### `run-night: <ref>: no <provider> credentials; ...`

- **Cause:** the model check found no key or Pi login for a model in the config (`src/pi/check.ts`).
- **Fix:** follow the hint in the message ([01_setup.md#pi-model-providers](01_setup.md#pi-model-providers)), then run `npm run server` again so the container gets the new `.env` and `auth.json`.

### Every experiment fails with `agent_error` on the first model call

- **Cause:** a wrong key. The model check finds missing keys, not wrong ones.
- **Fix:** replace the key in `.env` or re-run `/login` in `npx pi`, then `npm run server` again.

### `paused in round <N> (<where>); resume with: npm run run-night -- resume --night <id>`

- **Cause:** a provider returned a credit or quota error (402, or a key limit).
- **Fix:** add credits, then `npm run run-night -- resume --night <id>` ([02_running.md#pause-and-resume](02_running.md#pause-and-resume)).

### The program's model calls return `401`, `402`, `403`, `400`, `413` or `502`

- **Cause:** the metering proxy refused or failed the call: `401` bad or revoked token, `403` model not in `allowed_models`, `402` budget spent, `400` unsupported request (streaming, tools), `413` body over 16 MiB, `502` upstream failure.
- **Fix:** check `allowed_models` and `budget_usd` in the config; `nights/<id>/evals/*/meter.jsonl` lists each call.

### Metered nights break while another server runs

- **Cause:** `cc-meter-relay` forwards to one server at a time. A second Agent Server (another checkout's), or the relay test in `npm test`, recreates it with its own target.
- **Fix:** run one server per machine for metered nights; don't run `npm test` during one.

### `api: cannot serve on 127.0.0.1:7421: ...`

- **Cause:** another `npm run api` holds the port. Two APIs would run two watchdogs over the same nights, so a busy port is a startup error.
- **Fix:** for this checkout, stop the other one. Only an API of another checkout may run beside it: start that one with `CODECLIMB_API_PORT=7431` and point its app at it with `CODECLIMB_WORKER_URL`.

### `the worker API on <host> needs CODECLIMB_WORKER_TOKEN`

- **Cause:** `CODECLIMB_API_HOST` is off loopback with no token (`src/api/server.ts`).
- **Fix:** set `CODECLIMB_WORKER_TOKEN` on the API, and the same token plus `CODECLIMB_WORKER_URL` on the app.

### A restarted server cannot replay a running night

- **Cause:** `npm run server` after a code change recreates the container; a night started by older code can't be replayed by new code.
- **Fix:** let running nights finish or stop them before restarting onto new code.

## FAQ

**Why does a mock night need a LangSmith key?**
The Agent Server checks the key at boot and exits without it. Set `LANGSMITH_TRACING=false` to send no traces; the free Developer plan is enough.

**What happens when the server container is killed mid-night?**
Run `npm run server` again. About 2 minutes after `up`, the server's runs sweeper reruns the killed run: stored steps return their saved results and only the step running at the kill runs again, on a new sandbox of the same name. Postgres and Redis keep running through it.

**Why does the starter score 0 when the datenorm stub really scores 0.125?**
The starter is never run and scores 0 by definition. The `datenorm` stub answers `null` for everything, which is right for the `invalid` family only.

**Why does `datenorm.yaml` stop after one round?**
On the [Inngest](https://inngest.link/dai-gh) twin, Haiku 5.5 solved `datenorm` in round 1 (0.98 to 1.0 on dev), and the threshold is 0.99. Use `datenorm-hard` for a longer climb ([02_running.md#datenorm-hard](02_running.md#datenorm-hard)).

**Can this branch and the Inngest build run on one machine?**
Yes: they write to `runs-langchain/` and `runs-inngest/`. Don't run metered nights on both at once, since both use `cc-meter` and `cc-meter-relay`.

**Is a mock night's score meaningful?**
No. A mock night checks that everything ran; a score of 0 is expected.

Next: [../README.md#guides](../README.md#guides)
