# 42: Cloud nights: mock nights on Inngest Cloud, with the operator's go-ahead

**What to build:** Nothing new. The finished build runs the nights that need Inngest Cloud: one through the cloud worker on Docker sandboxes, one on Inngest Sandboxes. Both use mock models, so no provider is paid, but they use the operator's Inngest Cloud account and microVM time may bill. Each night runs only when the operator says so for that run. Anything a night shows broken is fixed in the ticket that owns it, and the night is run again with a new go-ahead.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Goal and done signal", "Deployment and environment", "Durable runtime on Inngest", "Inngest Sandboxes backend", "Platform facts found while building", "What you get, what you build", "Result row"

**Blocked by:** 41 (Final acceptance: the whole spec, checked once more)

**Status:** ready-for-human

- [ ] Before each night the operator gives the go-ahead for that run, after being told what it uses (the Inngest Cloud account; for the second night, microVM time that may bill). A night without a go-ahead is reported as not run, never as passed
- [ ] The Inngest Cloud keys come from `.env`; with a key missing the night is reported as not run
- [ ] Cloud worker, Docker sandboxes: `datenorm-smoke --mock --sandbox docker` through `npm run worker:cloud` and `npm run run-night:cloud` prints `done`
- [ ] Inngest Sandboxes: `datenorm-smoke --mock --sandbox inngest` through the cloud worker prints `done`, and its rows carry `backend: inngest`. The graphrag image `codeclimb-graphrag:v2` is assumed published, as the spec states; this night does not need it
- [ ] The spec names no paid real-model night and no spend ceiling, so none is run here: `--mock` stays on for both nights
- [ ] A short report lists, per night: go-ahead given or not, ran or not run, passed or failed, and what was fixed
