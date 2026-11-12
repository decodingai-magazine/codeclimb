# codeclimb (LangChain stack)

CodeClimb on the LangChain ecosystem: LangGraph JS for orchestration and durability, LangSmith for tracing and feedback, Docker for sandboxes. The Inngest implementation lives on `main`. The build spec is `docs/codeclimb-spec-langchain.md`.

## Layout

- `src/`: graphs (registered in `langgraph.json`), CLI, worker API, sandboxes, metering proxy
- `web/`: the app (Next.js)
- `configs/`: night configs (YAML)
- `scenarios/`: scenarios (spec, starter, gold, scripts)
- `docker/`: sandbox images and the server's compose override

## Local setup

Requires Node.js 24+ and Docker.

```bash
npm install --ignore-scripts
cp .env.example .env           # set LANGSMITH_API_KEY: the server does not boot without it
npm run build:image            # codeclimb-python sandbox image
npm run build:image:graphrag   # codeclimb-graphrag, for the graphrag scenario
npm run server                 # Agent Server at http://127.0.0.1:8123
```

`npm run server` runs `langgraphjs up`: it builds the server image from the checkout and starts three containers (the server, its Postgres and its Redis). Run it again after a code change. In a git worktree, symlink `.env` to the main checkout's.

```bash
curl -s http://127.0.0.1:8123/ok
npm run server:logs            # follow the server container's logs
npm run server:stop            # stop the stack; Postgres keeps every thread
```

## A night

```bash
npm run run-night -- --config configs/capitals-smoke.yaml --mock   # mock models, costs nothing
npm run api                                                         # worker API at http://127.0.0.1:7421
npm run dev                                                         # the app
```

Night output goes to `runs-langchain/`.

## Checks

```bash
npm run typecheck
npm test
```

End-to-end nights: `.claude/skills/codeclimb-e2e/SKILL.md`.
