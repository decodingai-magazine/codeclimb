# 38: Web research for the coder, behind the guard

**What to build:** On a real-model night the coder may search and fetch public web pages, on the host, through `pi-web-access`. The guard limits it to plain search and readable fetches and refuses the project's own repository (it holds the gold), other GitHub pages and video hosts. Off in mock mode, and never for a repair.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Web research guard; Coder; Repair), "Mock mode", "Dependencies"

**Blocked by:** 20 (Check table: mock nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] A real-model coder session gets web search and fetch tools from `pi-web-access`, running on the host; its four sandbox tools stay as they are, and no other tool is added
- [ ] The guard allows plain search and readable fetches only (unit tests with a fake tool API)
- [ ] The guard refuses the project's own repository, every other GitHub page and video hosts (unit tests)
- [ ] Mock sessions and repairs get no web tools
- [ ] No test reaches the real web or makes a paid call
- [ ] Nights 1 to 3 still pass the check of ticket 20
