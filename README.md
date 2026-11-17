<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/sponsors/inngest-dark.svg">
    <img src="assets/sponsors/inngest-light.svg" alt="Inngest logo" width="200">
  </picture>
  <h1>CodeClimb</h1>
  <h3>Let a coding agent climb your eval scores overnight, with caps it can't override</h3>
  <p><a href="#quickstart">Quickstart</a> · <a href="#guides">Guides</a> · <a href="#see-it-in-action">See it in action</a> · <a href="#questions-and-troubleshooting">Questions</a></p>
</div>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/decodingai-magazine/codeclimb" alt="License"></a>
  <img src="https://img.shields.io/badge/mock_night-%240-green" alt="mock night: $0">
  <img src="https://img.shields.io/badge/durability-Inngest-black" alt="durability: Inngest">
  <img src="https://img.shields.io/badge/node-%E2%89%A520-blue" alt="node: >=20">
</p>

A coding agent left alone overnight burns credits with no stop, holds your API keys in its sandbox, and loses every paid round when it crashes at 5 AM. CodeClimb runs Pi coding agents in sandboxes, round after round, and keeps a change only when it beats the best checkpoint on a dev split the agent never sees. Spend caps, deadlines and stops fire in code, keys stay in a metering proxy on the host, and Inngest checkpoints every step, so a crash costs one round.

**Before:** a 23,000-line agent diff you can't review and a $10 run that died mid-turn. **After:** a 26-round graphrag night, 11.8 hours, $74.63, every kept commit scored on dev and the winner once on test.

## How it works

![CodeClimb architecture: experiment, evaluate on dev, repeat until done, then evaluate on test](assets/architecture.png)

- **Experiment** — a Pi coding agent in a Docker or Inngest sandbox; writes one commit per round from the spec, the train split and the history.
- **Evaluation** — a separate sandbox runs the commit on dev; host-side scorers turn outputs into metrics the coder never sees.
- **Keep rule and stops** — TypeScript in the worker; keeps a commit only above the measured noise, stops on thresholds, rounds, deadline, budget or plateau.
- **Metering proxy** — in the worker; holds the provider keys, hands each sandbox a capped, expiring token for the allowed models only.
- **Inngest + dashboard** — Inngest checkpoints and retries every step; the Next.js app watches, stops and exports nights.

## Learn to build durable long-running agents

> Decoding AI teaches how to build AI agents you can trust to run unattended: evals, guardrails, durability and cost control.

<p align="center">
  <a href="https://www.decodingai.com/">
    <img src="https://img.shields.io/static/v1?label&logo=substack&message=Read%20on%20Substack&style=for-the-badge&color=black" alt="Decoding AI on Substack" height="40">
  </a>
  &nbsp;
  <a href="https://www.youtube.com/@itsdecodingai">
    <img src="https://img.shields.io/static/v1?label&logo=youtube&message=Watch%20on%20YouTube&style=for-the-badge&color=black" alt="Decoding AI on YouTube" height="40">
  </a>
</p>

## Quickstart

**Needs:** Node.js 20+ · Docker running · no keys for the mock night · $0 ([cost by path](guides/01_setup.md#cost)) · no GPU

```bash
git clone https://github.com/decodingai-magazine/codeclimb.git && cd codeclimb
npm ci --ignore-scripts
npm run build:image                     # the codeclimb-python sandbox image
npm run dev:inngest                     # terminal 1: Inngest dev server, UI at http://localhost:8288
npm run worker                          # terminal 2: the connect() worker
npm run run-night -- --config configs/datenorm-smoke.yaml --mock   # terminal 3
```

In about 30 seconds the last command prints `done` and the night's `done.json` with `"stop_reason": "max_rounds"` and `"spend_usd": 0`: two rounds of sandboxes, commits, evaluations and reviews on scripted models. Results land in `runs-inngest/mock/datenorm-smoke/`.

**Set up with your coding agent:**

```txt
Clone https://github.com/decodingai-magazine/codeclimb, follow guides/ from 01_setup.md onward
(00_troubleshooting.md on any error), and set it up until npm test passes and
npm run run-night -- --config configs/datenorm-smoke.yaml --mock prints done.
Ask me for any API key it needs.
```

## Guides

| Guide | Read it when |
|---|---|
| [01_setup.md](guides/01_setup.md) | You install CodeClimb, add model credentials or Inngest Cloud keys, or want the cost of each run path |
| [02_running.md](guides/02_running.md) | You start, stop, resume, continue, seed or export a night, run graphrag, use Inngest Cloud or open the dashboard |
| [03_how_it_works.md](guides/03_how_it_works.md) | You need the loop's steps, the keep rule, the stops, the metering proxy, the files a night writes, the worker API or the code layout |
| [00_troubleshooting.md](guides/00_troubleshooting.md) | A command fails, a night pauses, or a score looks wrong |

## Who is this for

| Audience | What you get |
|---|---|
| AI engineers with a measurable problem (RAG, extraction, retrieval) | A loop that improves code against your dataset and metrics while you sleep, with test scored once at the end |
| Engineers running long or overnight coding agents | Working patterns for spend caps, a key-holding proxy, checkpoints and a credit pause with human resume |
| Inngest users | A real `connect()` worker with parent and child functions, step retries, cancellation and Inngest Sandboxes |

## See it in action

**Check the whole loop for free.** A mock night runs real Inngest functions, sandboxes, Pi sessions, commits and evals on scripted models.

```bash
npm run run-night -- --config configs/datenorm-smoke.yaml --mock
```

```txt
  r1 experiment dev   r1-e0   accuracy=0.1250 keep   $0.0000 · mock change, no real work
  r2 noise      dev   r1-e0   accuracy=0.1250 keep   $0.0000 · the kept commit, scored again without replayed model calls
  r2 experiment dev   r2-e0   accuracy=0.1250 revert $0.0000 · mock hypothesis
  r2 test       test  r1-e0   accuracy=0.1250 keep   $0.0000
done
```

**Build GraphRAG from a spec.** CodeClimb wrote a GraphRAG system over 22 Decoding AI articles, scored on extraction, graph merging and retrieval. The screenshot is a 26-round night with a larger budget; the shipped config runs 24 rounds with a $60 cap, paid on an Anthropic key and OpenRouter.

```bash
npm run run-night:cloud -- --config configs/graphrag.yaml
```

![The winning graphrag night: kept mention F1 0.764, test graph recall 0.994, test retrieval 0.909, 26 rounds, $74.63, 11.8 h](assets/example-graphrag.png)

## Sponsors

<p align="center">
  <a href="https://inngest.link/dai-nl"><img src="assets/sponsors/inngest-banner.png" alt="Inngest x Decoding AI" width="100%"></a>
</p>

<p align="center">
  <a href="https://inngest.link/dai-nl">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/sponsors/inngest-dark.svg">
      <img src="assets/sponsors/inngest-light.svg" alt="Inngest" height="24">
    </picture>
  </a>
</p>

<p align="center">Special thanks to <a href="https://inngest.link/dai-nl">Inngest</a> for sponsoring this project.</p>

## Questions and troubleshooting

Open a [GitHub issue](https://github.com/decodingai-magazine/codeclimb/issues) for questions and bugs. Known failures and their fixes are in [00_troubleshooting.md](guides/00_troubleshooting.md).

## Security

Coder agents run shell commands in Docker or Inngest sandboxes with open egress, and Pi runs in the worker on your machine, so provider keys (`.env`, `~/.pi/agent/auth.json`) and gold data never enter a sandbox: the program reaches models only through the metering proxy with a capped, revocable token. The worker API and the app bind to `127.0.0.1` and need `CODECLIMB_WORKER_TOKEN` off loopback; in cloud mode, runs, step outputs and traces go to Inngest Cloud. Details: [03_how_it_works.md#metering-proxy](guides/03_how_it_works.md#metering-proxy).

## Learn to build durable long-running agents

> Decoding AI teaches how to build AI agents you can trust to run unattended: evals, guardrails, durability and cost control.

<p align="center">
  <a href="https://www.decodingai.com/">
    <img src="https://img.shields.io/static/v1?label&logo=substack&message=Read%20on%20Substack&style=for-the-badge&color=black" alt="Decoding AI on Substack" height="40">
  </a>
  &nbsp;
  <a href="https://www.youtube.com/@itsdecodingai">
    <img src="https://img.shields.io/static/v1?label&logo=youtube&message=Watch%20on%20YouTube&style=for-the-badge&color=black" alt="Decoding AI on YouTube" height="40">
  </a>
</p>

## Star history

<a href="https://www.star-history.com/?type=date&repos=decodingai-magazine%2Fcodeclimb">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=decodingai-magazine/codeclimb&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=decodingai-magazine/codeclimb&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=decodingai-magazine/codeclimb&type=date&legend=top-left" />
 </picture>
</a>

## License

[Apache License 2.0](LICENSE)
