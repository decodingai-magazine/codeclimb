# Runtime

How codeclimb runs your system. It adds to `train.md`, What you submit.

- **Command.** `python -m graphrag <stage> --root <dir> --inputs <file> --out <file> [--graph <file>]`,
  run from the repository root. Keep that entry point; everything behind it is yours.
- **Python 3.14** with `numpy`, `networkx`, `openai`, `pydantic`, `ladybug` and `rank-bm25`
  installed (pinned versions), plus `uv`. That's a starting point, not a limit: the sandbox has
  internet access.
- **Other packages.** Add what you need with uv, when you need it:

  ```bash
  uv init --bare                      # if there's no pyproject.toml
  uv venv --system-site-packages      # keeps the packages above importable
  uv add <package>
  .venv/bin/python -m graphrag …
  ```

  Commit `pyproject.toml` and `uv.lock`. The evaluator builds the same environment from `uv.lock`
  before the first stage and runs every stage in it. A failed build fails the submission, and the
  time it takes isn't scored.
- **Ladybug, if you want a graph store.** `ladybug` is a graph database in one file, as SQLite is
  for tables: it runs inside your process, with no server. Define node and relationship tables,
  load the rows, and query with Cypher. Build it in a temporary directory, because nothing persists
  between stages. The full graph loads in seconds, row by row.

  ```python
  import ladybug as lb
  conn = lb.Connection(lb.Database("/tmp/graph.lbug"))
  conn.execute("CREATE NODE TABLE Entity(id STRING PRIMARY KEY, name STRING)")
  conn.execute("CREATE REL TABLE Rel(FROM Entity TO Entity, semantic_type STRING)")
  rows = conn.execute("MATCH (a:Entity {name: $name})-[:Rel*1..3]->(b) RETURN b.name", {"name": "Pydantic"})
  while rows.has_next():
      print(rows.get_next())
  ```
- **Models.** Call models only through the OpenAI-compatible endpoint in `OPENAI_BASE_URL` with
  `OPENAI_API_KEY`, and only the models the prompt lists. Every call is metered and capped; a call
  past the cap fails. The prompt names the caps. The evaluation's cap covers all three stages
  together. A request body can be at most 16 MB.
  - **Errors.** The endpoint doesn't retry. Retry a 429 or 502 with backoff, and catch it: one
    unhandled failure ends the run. A 402 means the money is spent, so stop calling and write the
    rows you have. A 400 or 403 is a bad request and won't pass on retry. Bound the calls a query
    can make: a burst of reranks overloads the provider, and those calls fail after every retry.
    When calls still fail, log it and write what you have. A fallback that hides the failure
    looks like a bad result, and nobody can tell why it scored low.
  - `POST /chat/completions`: text messages only, no streaming or tools; `response_format`, `seed`,
    `top_p`, `stop` and `reasoning` pass through, and a model that doesn't support one ignores it.
    `max_tokens` counts a model's reasoning too: when reasoning uses it up, the reply has empty
    `content` and `finish_reason: "length"`, with the call still paid for. Check `finish_reason`,
    and turn reasoning off with `"reasoning": {"enabled": false}` (through the `openai` client,
    `extra_body={"reasoning": {"enabled": False}}`) unless the task needs it.
  - `POST /embeddings`: `openrouter/qwen/qwen3-embedding-4b`. Read the vector size from the reply.
  - `POST /rerank`: `openrouter/qwen/qwen3-reranker-8b` takes `{"model", "query", "documents"}`, where
    `documents` is a list of strings, plus an optional `top_n`. It returns
    `{"results": [{"index": 0, "relevance_score": 0.05}]}`, best first, where `index` points into
    `documents`. Scores can be tiny and aren't probabilities: sort by them. The `openai` client has
    no method for it: call `client.post("/rerank", body=…, cast_to=dict)` or plain HTTP.
  - `POST /decisions`: `openrouter/typesafe/jev-1.14` is a decisions model and refuses chat. It takes
    `{"model", "state", "questions"}`, where `state` is a string holding the facts to decide on, and
    `questions` maps a name of your own to one question. It returns one probability per name. The
    `openai` client has no method for it: call `client.post("/decisions", body=…, cast_to=dict)` or
    plain HTTP.

    ```json
    {"model": "openrouter/typesafe/jev-1.14",
     "state": "Surface A: tool calling (method). Surface B: tool-calling (method).",
     "questions": {"same": {"type": "noul", "instructions": "Do A and B name one referent?",
                            "criteria": {"false": "two things", "true": "one thing"}}}}
    ```

    ```json
    {"answers": {"same": {"type": "noul", "noul": 0.72}}}
    ```
- **Your bundle** is at `/spec`: `/spec/spec/` (this spec), `/spec/corpus/` (train articles),
  `/spec/train/` (gold graph, examples, inputs). Use `--root /spec` to run on train.
- **Evaluation** runs each stage on dev with gold input; each stage gets the eval time limit the
  prompt names, on its own. Only your repository, `--root`, `--inputs` and `--graph` exist there.
  `known_entities` grows with history: a held-out document gets every earlier document's entities, so
  a prompt that holds all of it may no longer fit or may cost far more.
  A stage that crashes, overruns or writes a field the schema doesn't allow (`train.md`, Inputs and
  predictions) fails the whole submission: no stage is scored. Dev's scores come back as the
  reviewer's feedback; test is scored once at the end.
