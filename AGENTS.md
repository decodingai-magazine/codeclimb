<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Inngest debugging

Use the Inngest CLI to inspect function runs and traces:

- Get a run: `npx inngest-cli@latest api --prod --env production get-function-run <run_id>`
- Get a trace: `npx inngest-cli@latest api --prod --env production get-function-trace <run_id> --include-output`
- Get runs from an event: `npx inngest-cli@latest api --prod --env production get-event-runs <event_id> --include-output --limit 5`
- Invoke locally: `npx inngest-cli@latest api invoke-function <app_id> <function_id> --data '{...}'`

Output is JSON. Use jq to filter.
Cloud commands use the stored OAuth login unless INNGEST_API_KEY or an explicit key flag overrides it.
Set --env to the intended environment.
If access is denied, ask the user to review the session's permissions.
