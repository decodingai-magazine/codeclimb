# 01: Project scaffold, npm scripts, env file and sandbox images

**What to build:** A fresh checkout installs with lifecycle scripts off, type-checks, runs an (empty) unit-test suite, and builds the sandbox images every later ticket runs on. Every npm script the spec fixes exists by name from now on, so later tickets fill them in instead of renaming them. The env file is loaded the way the CLI and the worker will need it.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "What you get, what you build", "Deployment and environment"

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `package.json` pins every dependency of the spec's dependency table to its exact version; a package the table does not list (type packages, for example) is added only when the build cannot do without it, pinned exactly and named in the ticket's report; `npm ci --ignore-scripts` succeeds and installs one copy of `@earendil-works/pi-ai`
- [ ] Every npm script the spec fixes is defined: `dev:inngest`, `worker`, `run-night`, `validate-results`, `build:image`, `build:image:graphrag`, `export`, `lessons`, `dev`, `build`, `start`, `typecheck`, `test`. A script whose feature is not built yet exits non-zero with a message naming it
- [ ] `worker`, `run-night` and `dev` set `INNGEST_DEV=1`; `worker` alone preloads `@inngest/otel`; `dev:inngest` runs the Inngest CLI's dev command through `npx` with install scripts allowed for that package only
- [ ] TypeScript on Node 24, ESM, run from source with `tsx`; `npm run typecheck` and `npm test` (Node's test runner) pass
- [ ] The env file loader reads one `.env`, lets values already in the shell win, and is covered by unit tests; `.env.example` lists every variable of the spec's environment table; `.env`, `runs/` and build output are gitignored
- [ ] `npm run build:image` produces `codeclimb-python` and `npm run build:image:graphrag` produces `codeclimb-graphrag`, both meeting the image contract in "What you get, what you build" (use the given image definitions when the environment holds them, write them otherwise)
- [ ] A check run in a `codeclimb-python` container proves: `git`, `uv` 0.13.5, `bash`, `setsid`, `tar`, `python3` exist; the git identity, default branch `main` and safe-directory setting hold; workdir is `/repo`; the three environment variables are set; the command is `sleep infinity`
