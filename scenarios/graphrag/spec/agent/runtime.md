# Runtime

How codeclimb runs your system. It adds to `train.md`, What you submit.

- **Command.** `python -m graphrag <stage> --root <dir> --inputs <file> --out <file> [--graph <file>]`,
  run from the repository root. Keep that entry point; everything behind it is yours.
- **Python 3.14** with these packages installed, and nothing else: `numpy`, `networkx`, `openai`,
  `pydantic`, `rank-bm25` (pinned versions). The evaluator can't install packages.
- **Models.** Call models only through the OpenAI-compatible endpoint in `OPENAI_BASE_URL` with
  `OPENAI_API_KEY`, and only the models the prompt lists. Every call is metered and capped; a call
  past the cap fails.
- **Your bundle** is at `/spec`: `/spec/spec/` (this spec), `/spec/corpus/` (train articles),
  `/spec/train/` (gold graph, examples, inputs). Use `--root /spec` to run on train.
- **Evaluation** runs each stage on dev with gold input; each stage gets the eval time limit the
  prompt names. Dev's scores come back as the reviewer's feedback; test is scored once at the end.
