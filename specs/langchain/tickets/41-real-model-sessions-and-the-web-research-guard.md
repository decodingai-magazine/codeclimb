# 41: Real-model sessions and the web research guard

**What to build:** On a real-model night every Pi session (coder, reviewer, lessons) runs on the model its config names as `<provider>/<id>`, with its thinking level, and with credentials from the provider keys or Pi's `auth.json`. The coder may also search and fetch the web, on the host, but only through three tools with narrowed inputs: no other plugin tool, no call that would use the host's credentials or another model, and never the project's own repository, which holds the gold. Web research is off in mock mode.

**Spec sections:**
- "Features": **Web research guard**; **Coder** ("plus guarded web research"); **Reviewer** ("on a model or a thinking level that differs from the coder's")
- "Runtime and tools": the Pi bullet (`pi-web-access`)
- "Interfaces the build must honour" > "Night config": `model`, `reviewer_model`, `coder_thinking`, `reviewer_thinking`
- "Interfaces the build must honour" > "Given inputs": credentials (`.env`, Pi's `auth.json`)
- "Interfaces the build must honour" > "Environment": the provider keys, `CODECLIMB_PI_AUTH_PATH`
- "Interfaces the build must honour" > "Mock mode": "skipped: the model checks, the smoke test, web research"

**Not yet:** nothing is prompted for real in tests. A paid night needs the operator's go-ahead and is not part of this ticket.

**Blocked by:** 21 (Gate: nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] A non-mock session resolves `<provider>/<id>` through Pi with its role's thinking level; credentials come from the provider keys (`ANTHROPIC_API_KEY`, `OPENCODE_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`) or from the `auth.json` at `CODECLIMB_PI_AUTH_PATH`, by default Pi's own; no credential enters a sandbox
- [ ] Spend and tokens of every session are counted into `coder_usd`, `reviewer_usd` and `tokens`
- [ ] On a real-model night the coder's tools are the four sandbox tools plus exactly three web research tools of `pi-web-access`; every other plugin tool is unavailable
- [ ] The three tools' inputs are narrowed so no call uses the host's credentials or another model
- [ ] Search results and fetches never reach the project's own repository
- [ ] Web research is off in mock mode and in sessions with no tools
- [ ] Unit tests cover the tool list, the input narrowing and the repository rule on plain inputs, and that a real-model session is built with the guard; nothing is prompted for real
- [ ] The gate of ticket 21 still passes: a mock session gets no web tools
- [ ] `npm run typecheck` and `npm test` pass
