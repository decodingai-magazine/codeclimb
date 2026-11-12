# 37: Web research for the coder, behind the guard

**What to build:** `pi-web-access` gives the coder `web_search`, `fetch_content` and `get_search_content`, running on the host. Because that plugin registers more tools and resets the active list itself, a second extension loaded after it re-pins the tools, blocks every other plugin tool, rewrites each call's input and applies the fetch rules. Web research is off in mock mode.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Web research guard", "Coder", "Pi facts found while building", "Mock mode"

**Blocked by:** 20 (Done signal: both mock nights pass the end-to-end checks)

**Status:** ready-for-agent

- [ ] The coder's session is built through Pi's default resource loader with discovery of extensions, skills, prompts, themes and context files off and the two extension factories passed explicitly, the guard after `pi-web-access` (whose extension is the default export of the package's built entry file)
- [ ] The active tools are re-pinned to the four sandbox tools plus the three web tools at session start and before each agent start; every other plugin tool is blocked (unit tests with a fake extension API)
- [ ] Input rewriting follows the table: kept inputs and forced values for `web_search` and `fetch_content`, `get_search_content` untouched (unit tests)
- [ ] Fetch rules: http(s) only; a github.com `/blob/` URL becomes its raw-file URL; every other github.com page refused; the four video hosts refused (unit tests)
- [ ] The project's own repository is off limits on the five hosts when the worker's checkout has a GitHub `origin`, links to it are cut from search results, and there is no such rule without a GitHub origin (unit tests)
- [ ] Mock sessions get no web tools; the repair prompt allows no research
- [ ] No criterion needs a paid call: provider and platform paths are tested against fakes; no test reaches the real web
- [ ] Both mock nights of ticket 20 still pass every check of "Goal and done signal"
