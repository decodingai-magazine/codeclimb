# 31: Real-model coder sessions and the web research guard

**What to build:** On a real-model night the coder, the reviewer and the lessons sessions run on any Pi provider named `<provider>/<id>`, with credentials from env keys or Pi's `auth.json`, and their cost is Pi's catalog price per message. The coder can also research the web through three tools of `pi-web-access`, behind a guard that pins the tool list, forces safe inputs, and keeps the project's own repository and other unsafe hosts out of reach.

**Spec sections:**
- "Coder": the bullets on providers and credentials and on web research
- "Coder" > "Web research guard": all of it
- "Coder" > "Pi facts found while building": the "Isolation" and "Cost and tokens" rows
- "What you get, what you build": the `pi-web-access` row
- "Deployment and environment": `CODECLIMB_PI_AUTH_PATH`; the git directory mount that lets the guard read `origin`
- "CLI" > "Mock mode": web research is off

**Not yet:** nothing is prompted for real in tests. A paid night needs the operator's go-ahead and is not part of this ticket.

**Blocked by:** 12

**Status:** ready-for-agent

- [ ] A non-mock session resolves `<provider>/<id>` through Pi's model runtime with the thinking level of its role; credentials come from env keys or the `auth.json` at `CODECLIMB_PI_AUTH_PATH` (default Pi's own path)
- [ ] The guard is a second extension loaded after `pi-web-access`, through Pi's default resource loader with discovery switched off and the two factories passed explicitly; the session still loads nothing else from the host
- [ ] Active tools are re-pinned to the four sandbox tools plus `web_search`, `fetch_content` and `get_search_content` at session start and before each agent start; every other plugin tool is blocked
- [ ] Each call's input is edited in place as the table says: kept inputs, forced `provider`, `workflow`, `includeContent`, `mode` and `proxy`
- [ ] Fetch rules: http(s) only; a github.com `/blob/` URL becomes its raw-file URL; other github.com pages and the listed video hosts are refused
- [ ] The checkout's GitHub `origin` is off limits on every host the spec lists, and links to it are cut from search results; with no GitHub origin there is no such rule
- [ ] Web research is off in mock mode; the reviewer and lessons sessions never get it
- [ ] Unit tests cover the input edits, the fetch rules and the repository rule on plain inputs, and that a real-model session is built with the guard loaded last; `npm run typecheck` and `npm test` pass
