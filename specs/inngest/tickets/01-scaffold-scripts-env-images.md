# 01: Project scaffold, npm scripts, env loading and sandbox images

**What to build:** A fresh checkout installs with lifecycle scripts off, type-checks, runs its unit tests, and builds both sandbox images and the generated overfit scenario that later tickets run on. Every npm script the spec fixes exists by name from now on, so later tickets fill them in instead of adding or renaming them. The optional `.env` is loaded the way the CLI and the worker will need it.

**Spec sections** (`specs/inngest/spec.md`): "Given inputs and tools", "Environment", "Runtime and tools", "Numbers", "Dependencies"

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `package.json` pins every package of "Dependencies" at its exact version and keeps the given `inngest` package and `dev:inngest` script as given; a package the table does not list (type definitions, for example) may be added, pinned to an exact version and named in the ticket's report
- [ ] On a fresh checkout `npm ci --ignore-scripts` succeeds within 900 s
- [ ] Every npm script "Given inputs and tools" lists is defined: `dev:inngest`, `worker`, `run-night`, `validate-results`, `build:image`, `build:image:graphrag`, `build:scenario:overfit`, `export`, `lessons`, `dev`, `build`, `start`, `typecheck`, `test`. A script whose feature is not built yet exits non-zero with a message naming that feature
- [ ] TypeScript on Node 24, ESM; `npm run typecheck` passes within 600 s; `npm test` runs Node's test runner and passes within 1,200 s with no service up
- [ ] The CLI and the worker load an optional `.env` when present, values already in the shell win, and a missing `.env` is not an error (unit tests)
- [ ] `npm run build:image` builds `codeclimb-python` from `docker/python.Dockerfile`, and `npm run build:image:graphrag` builds `codeclimb-graphrag` from `docker/graphrag.Dockerfile` with build context `scenarios/graphrag`, each within 1,200 s
- [ ] `npm run build:scenario:overfit` runs `scenarios/datenorm/scripts/build_overfit.py --out generated/datenorm-overfit`, the scenario `configs/e2e/overfit.yaml` names
- [ ] `scenarios/`, `configs/`, `docker/` and `.env.example` are byte-identical to what the checkout was given; `runs-inngest/` and `generated/` stay out of git
