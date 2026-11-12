# 39: Inngest Sandboxes backend

**What to build:** A second backend behind the same interface: one microVM per sandbox, driven through the SDK's direct sandbox client inside steps. It works around what the platform lacks (lookup by name, stdin, labels, long-watched commands, `/spec` in the image) as "Platform facts found while building" records, and respects the one hour of active runtime each sandbox gets.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Inngest Sandboxes backend", "Platform facts found while building", "Sandboxes", "Evaluator", "Night config", "Cleanup", "Known gaps"

**Blocked by:** 22 (Crash and resume: a retried coder or evaluator step picks up its work); 38 (Cloud mode: the worker and the CLI against Inngest Cloud)

**Status:** ready-for-agent

- [ ] Create passes the name, 2 vCPU, 2,048 MB, the scenario's `inngest_image` when it has one, a 45 s running timeout and `PYTHONDONTWRITEBYTECODE=1`; it retries up to 6 times on a start timeout (destroying the stuck sandbox by the id the error carries), a taken name, a retryable error or a result that is not running; then it uploads the bundle and the commit and sets the git defaults the Docker image bakes in (unit tests with a fake sandbox client)
- [ ] Find by name lists every page and filters by name and by a status that is not terminating, terminated or failed; a paused sandbox found is resumed; one still starting gets 30 s
- [ ] Exec: helpers up to 2 minutes as a single command run with an explicit working directory (`/` when `/repo` may be missing); anything longer, streamed or abortable as a sandbox process, waited in 60 s slices, killed with signal 9 and its children; stdin through an uploaded temporary file; output falling back to what was streamed
- [ ] Files: reads up to 64 KiB inline as base64, larger through the file download; write creates parent directories itself
- [ ] Sandbox names per run are tracked in the worker's memory for `run-cancelled-cleanup`; the night's prefix sweep covers a restarted worker; sweeping this backend fails soft when unreachable
- [ ] The maximum active time is 60 minutes: an evaluator sandbox is reused on a retry only when its age plus `eval_min × stages` plus 5 minutes fits, else a new one is made; the evaluator reset spares the guest agent's `init` processes and a published image's `sleep`
- [ ] The backend refuses dev mode; the row's `backend` is `inngest`
- [ ] The backend passes the same interface test suite as the Docker backend, run against a fake client that enforces the platform's limits (no stdin, no parent-directory creation, 5-minute watch limit, bounded output)
- [ ] Nothing in this ticket starts a real microVM: the backend is tested against the fake client. The night on Inngest Sandboxes is ticket 42, which runs only with the operator's go-ahead, since microVM time may bill
