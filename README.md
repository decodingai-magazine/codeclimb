# codeclimb (LangChain stack)

CodeClimb on the LangChain ecosystem: LangGraph JS for orchestration and durability, LangSmith for tracing and sandboxes. The Inngest implementation lives on `main`.

Status: dev environment only. `src/hello.ts` is a placeholder graph; the CodeClimb graphs replace it.

## Layout

- `src/`: graphs, registered in `langgraph.json`
- `configs/`: night configs (YAML)
- `scenarios/`: scenarios (spec, starter, gold, scripts)
- `docker/`: sandbox images

## Local development

Requires Node.js 24+.

```bash
npm install --ignore-scripts
cp .env.example .env         # set LANGSMITH_API_KEY
npm run dev                  # Agent Server at http://127.0.0.1:2024, Studio link in the output
```

Check it:

```bash
curl -s http://127.0.0.1:2024/ok
curl -s -X POST http://127.0.0.1:2024/runs/wait -H 'content-type: application/json' -d '{"assistant_id":"hello","input":{"name":"codeclimb"}}'
```

Type check: `npm run typecheck`.

## Sandbox images

```bash
npm run build:image            # codeclimb-python
npm run build:image:graphrag   # codeclimb-graphrag
```
