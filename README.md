# codeclimb

Next.js app with [Inngest](https://www.inngest.com) background functions.

## Local development

Requires Node.js 20+. Follows the [Inngest local development guide](https://www.inngest.com/docs/local-development).

```bash
npm install
```

Run the Inngest Dev Server and the app in two terminals:

```bash
# Terminal 1: Inngest Dev Server (UI at http://localhost:8288)
npm run dev:inngest

# Terminal 2: Next.js app (http://localhost:3000)
INNGEST_DEV=1 npm run dev
```

- `INNGEST_DEV=1` puts the Inngest SDK in local mode. Without it, the v4 SDK runs in cloud mode and fails because it has no Inngest Cloud signing key. To skip the prefix, add `INNGEST_DEV=1` to `.env.local`.
- The Dev Server reads `inngest.json`, which points it at `http://localhost:3000/api/inngest` and turns off auto-discovery.
- `dev:inngest` passes both `--ignore-scripts=false` and `--allow-scripts=inngest-cli` to `npx`. The CLI downloads its binary in a postinstall script, and npm 12 needs `--allow-scripts` to run it.

Open http://localhost:8288. **Apps** should list `codeclimb` and **Functions** should list `hello-world`.

### Trigger the hello world function

From the app, via `inngest.send()`:

```bash
curl -X POST http://localhost:3000/api/hello -d '{"name": "codeclimb"}'
```

Or from the Dev Server UI: open **Functions**, pick `hello-world`, select **Invoke** and send:

```json
{ "data": { "name": "codeclimb" } }
```

Then open **Runs** to see the steps and output.

### Debug the endpoint

```bash
curl -s http://localhost:3000/api/inngest
```

In local mode this returns `"mode": "dev"` and `"function_count": 1`.

### Agent access (MCP)

The Dev Server exposes an MCP endpoint at `http://127.0.0.1:8288/mcp` for listing functions, sending events and checking runs from a coding agent.

## Project layout

| Path | Purpose |
|---|---|
| `inngest/client.ts` | Inngest client (`id: "codeclimb"`) |
| `inngest/functions.ts` | `hello-world` function, triggered by `test/hello.world` |
| `app/api/inngest/route.ts` | Serve endpoint the Dev Server syncs and calls |
| `app/api/hello/route.ts` | Sends a `test/hello.world` event |
| `inngest.json` | Dev Server config |
