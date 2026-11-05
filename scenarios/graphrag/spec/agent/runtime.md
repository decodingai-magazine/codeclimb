# Runtime

How codeclimb runs your system. It adds to `train.md`, What you submit.

- **Command.** `python -m graphrag <stage> --root <dir> --inputs <file> --out <file> [--graph <file>]`,
  run from the repository root. Keep that entry point; everything behind it is yours.
- **Python 3.14** with these packages installed, and nothing else: `numpy`, `networkx`, `openai`,
  `pydantic`, `rank-bm25` (pinned versions). The evaluator can't install packages.
- **Models.** Call models only through the OpenAI-compatible endpoint in `OPENAI_BASE_URL` with
  `OPENAI_API_KEY`, and only the models the prompt lists. Every call is metered and capped; a call
  past the cap fails.
  - `POST /chat/completions`: text messages only, no streaming or tools; `response_format`, `seed`,
    `top_p`, `stop` and `reasoning` pass through, and a model that doesn't support one ignores it.
    `openrouter/anthropic/claude-haiku-5.5` ignores `seed` and `temperature`.
  - `POST /embeddings`: `openrouter/mongodb/voyage-4-lite` returns 1024 dimensions.
  - `POST /decisions`: `openrouter/typesafe/jev-1.14` is a decisions model and refuses chat. It takes
    `{"model", "state", "questions"}`, where `questions` maps a name to
    `{"type": "noul", "instructions": "…", "criteria": {"false": "…", "true": "…"}}`, and returns
    `{"answers": {"<name>": {"type": "noul", "noul": 0.72}}}`, a probability. The `openai` client has
    no method for it: call `client.post("/decisions", body=…, cast_to=dict)` or plain HTTP.
- **Your bundle** is at `/spec`: `/spec/spec/` (this spec), `/spec/corpus/` (train articles),
  `/spec/train/` (gold graph, examples, inputs). Use `--root /spec` to run on train.
- **Evaluation** runs each stage on dev with gold input; each stage gets the eval time limit the
  prompt names. Dev's scores come back as the reviewer's feedback; test is scored once at the end.
