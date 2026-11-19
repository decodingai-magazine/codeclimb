# 42: Final acceptance: the seven nights and the fixed contracts

**What to build:** The done signal. On a fresh `npm run server`, with the done signal's `.env`, the seven mock nights run one after the other and each passes every check the spec lists for it. Anything that fails is fixed in the code that owns it, and the suite runs again from night 1. Then the fixed contracts and the numbers are audited. No new feature is built.

**Spec sections:**
- "Goal and done signal": all of it
- "Interfaces the build must honour": every subsection
- "Numbers": all of it
- "Dependencies": all of it

**Not yet:** nothing is deferred. No check here makes a paid call.

**Blocked by:** 01 (Scaffold and Agent Server boot); 02 (Night config and scenario loading); 03 (Host commands, the bundle and masking); 04 (Stage reports and standard metrics); 05 (Decisions: weighted score, keep rule, noise margin and stop checks); 06 (Result rows and `validate-results`); 07 (Experiment repository); 08 (Sandboxes on Docker); 09 (Pi sessions on mock models); 10 (Coder experiment); 11 (Evaluator, unmetered); 12 (Tracer night: `datenorm-smoke` on mock models); 13 (Notes, history, rejected diffs and the trajectory); 14 (Reviewer); 15 (Send-backs, reserve and wrap-up); 16 (Check, leak scan and guardrails); 17 (Metering proxy); 18 (Metered nights: nights 1 and 3 pass); 19 (Noise run: night 2 passes); 20 (Model checks, smoke test, outage and every soft stop); 21 (Gate: nights 1 to 3 as one repeatable check); 22 (Stop command and cleanup: night 4 passes); 23 (Hard deadline, variation backstop and step backstops); 24 (Crash resume: night 5 passes); 25 (Lost connection mid-turn: night 6 passes); 26 (Pause for credits, resume and the pause timeout); 27 (Repair); 28 (Continue); 29 (Lessons file, operations and gates); 30 (Lessons distillation); 31 (Multi-stage night: night 7 passes); 32 (Seed); 33 (Rescore); 34 (Worker API); 35 (Watchdog); 36 (Export); 37 (App: nights list, status and controls); 38 (App: metric tables, chart, heatmap, experiment and export); 39 (Tracing and feedback); 40 (Proxy backends: OpenRouter and Pi); 41 (Real-model sessions and the web research guard)

**Status:** ready-for-agent

- [ ] On a clean checkout: `npm ci --ignore-scripts` within 900 s, `npm run typecheck` within 600 s, `npm run build:image` and `npm run build:image:graphrag` within 1200 s each, and `npm test` within 1200 s, run after `build:image` with `.env` present, no Agent Server up and no `codeclimb-graphrag` image
- [ ] The preconditions of "Goal and done signal" hold before night 1: the two images, the `.env` with only `LANGSMITH_API_KEY`, `LANGSMITH_ENDPOINT` and `LANGSMITH_TRACING=false`, `/ok` answering within 600 s of `npm run server`, no `cc-` container
- [ ] Night 1, `capitals-smoke --mock`: C1 to C14
- [ ] Night 2, `datenorm-smoke --mock`: C1 to C14; `max_rounds` after exactly 2 rounds
- [ ] Night 3, `e2e/plateau.yaml --mock`: C1 to C14 and night 3's added checks
- [ ] Night 4: night 2 with `--no-wait`, then `run-night stop` once `exps/<id>-r1-e0/` exists: every check of night 4
- [ ] Night 5: night 2 with `--no-wait`, the server container killed once `exps/<id>-r2-e0/` exists, then `npm run server` and nothing else: every check of night 5, within 480 s of the restart
- [ ] Night 6, `datenorm-smoke --mock --mock-offline 6`: C1 to C14 and night 6's session check
- [ ] Night 7, `graphrag-smoke --mock`: every check of night 7
- [ ] Every night meets its time limits in "Numbers"; after the suite no `cc-` container exists and every night under `runs-langchain/mock/` has a `done.json` or a `stop.json`
- [ ] `npm run build:app` succeeds; every npm script of "Commands and services" exists and does its job
- [ ] Every constant of "Numbers" and every default of "Night config" is found in the code once and matches
- [ ] The literal phrases "You stopped with" and "change no more code" each come from exactly one message builder
- [ ] `scenarios/`, `configs/` and `docker/` are byte-identical to the given inputs
- [ ] Every feature of "Features" and every row of "Interfaces the build must honour" is traced to the ticket that built it and to a test or a night check that shows it
