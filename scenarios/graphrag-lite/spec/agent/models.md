# Models

The four models the evaluation allows, one card each: what it is for, how to call it, what it costs,
and where it failed here. Everything below is a starting point, not a requirement; `runtime.md`
(Models) has the rules every call follows (the endpoint, the caps, errors, typed replies).

| model | endpoint | use it to | don't use it to |
|---|---|---|---|
| `openrouter/deepseek/deepseek-v4.1-flash` | `POST /chat/completions` | read text and write rows | decide between two close candidates: it gives no probability |
| `openrouter/qwen/qwen3-embedding-4b` | `POST /embeddings` | find candidates cheaply, by cosine similarity | make the final choice: it ranks by topic, not by identity |
| `openrouter/qwen/qwen3-reranker-8b` | `POST /rerank` | order a short list against a query | say which candidates to keep: its scores are not probabilities |
| `openrouter/typesafe/jev-1.14` | `POST /decisions` | answer yes or no with a probability, where a threshold is the design | filter entities or claims (`lessons.md`, Failed, more than once) |

Costs and times below are from earlier attempts' own runs on train. Measure yours: the endpoint
routes each call to one of several providers, and they differ in price and speed.

## Chat: `deepseek-v4.1-flash`

**For:** extraction (the entities call, the claims call), the critic pass, and any step that reads
prose and writes rows.

**Call:** text messages only, no streaming or tools. `response_format`, `seed`, `top_p`, `stop` and
`reasoning` pass through; every other field is dropped before the provider sees it.

```python
client.chat.completions.create(
    model=..., messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    response_format={"type": "json_object"}, temperature=0, seed=0, max_tokens=8000,
    extra_body={"reasoning": {"enabled": False}},
)
```

- **Reasoning off.** `max_tokens` counts reasoning too: when reasoning uses it up, the reply has
  empty `content` and `finish_reason: "length"`, with the call still paid for. Check
  `finish_reason`. Reasoning on also scored worse (`lessons.md`, Failed, more than once).
- **Not deterministic.** The same request at temperature 0 with a seed can be answered by a different
  provider and come back different. Only the endpoint's replay of a repeated request is exact
  (`train.md`, Scoring your work on train), so build each request the same way every run: sorted
  lists, no timestamps, no set order.
- **No prompt cache to design for.** A repeated system prompt is billed in full each time. A shorter
  prompt is cheaper; a reordered one is not.
- **JSON mode gives an object, not your schema.** Validate the reply yourself (`runtime.md`, Typed
  replies).
- **A reply cut at `max_tokens` is a loop** (`runtime.md`, Typed replies).

**Cost:** about $0.20 per million tokens, input and output together. A section call (the ontology
as system prompt, a 6000-character section) is about 4000 tokens in and 300 out: about $0.0003 to
$0.001, and 2 seconds at the median, 8 seconds for the slowest tenth. The ontology is most of the
input of every call.

## Embedding: `qwen3-embedding-4b`

**For:** finding candidates: surfaces that may be one entity, entities a query phrase may name,
edges and passages near a query.

**Call:** `client.embeddings.create(model=..., input=[...])`. Vectors have 2560 dimensions and unit
length, so the dot product is the cosine. Read the size from the reply, don't write it in code. One
text can hold about 32,000 tokens. Send texts in batches of a few hundred, not one call per text.

- **What to embed.** A name with its type and description (`Pydantic (tool): a Python library
  that…`), an edge as a short sentence (`Pydantic generates JSON Schema`), a passage as it is. A
  bare name carries little.
- **Query instruction.** The model was trained to take a task line on the query side only:
  `Instruct: <the task in one sentence>\nQuery: <the query>`, with documents embedded bare. The line
  is part of the text; no request field carries it. On one check here it did not widen the gap
  between the right entity and the wrong ones, so measure it on train's queries before keeping it.
- **Fuse, don't replace.** Embeddings and BM25 miss different candidates. Reciprocal rank fusion
  joins the two lists without tuning weights: a candidate's score is the sum over lists of
  `1 / (60 + rank)`.

**Cost:** $0.02 per million tokens: every entity of the full graph embeds for well under a cent.

## Reranker: `qwen3-reranker-8b`

**For:** ordering a short list against a query: an anchor's edges for `single_hop`, written as text
(`lessons.md`, Worked).

**Call:** your repository already wraps it: `Client.rerank(query, documents, top_n)` in
`graphrag/llm.py` returns `(index, score)` pairs, best first. Underneath, the `openai` client has no
method for this endpoint, so the wrapper calls `client.post("/rerank", body=…, cast_to=dict)`; plain
HTTP works too. The body is `{"model", "query", "documents"}`, where `documents` is a list of strings,
plus an optional `top_n`; no other field passes through. It returns
`{"results": [{"index": 0, "relevance_score": 0.05}]}`, best first, where `index` points into
`documents`.

- **Scores sort, they don't decide.** They can be tiny, they are not probabilities, and they shift
  with the query's wording: the same three documents scored 0.44, 0.002 and 0.0003 under one phrasing
  and 0.85, 0.015 and 0.003 under another, in the same order. Never set a keep threshold on them;
  use the decision model for a yes or no.
- **Write each candidate as a reader would need it.** An edge as its two ends, the label, the end
  types and descriptions. The reranker sees only the string.
- **Shortlist first.** Rerank about 20 to 100 candidates from BM25 and embeddings, never the whole
  graph. Bound the calls a query can make: a burst overloads the provider (`runtime.md`, Errors).
- **Task instruction.** A task line can be written into the query string, as for embeddings. It
  changes the scores; whether it changes the order for the better is not measured.

**Cost:** about $0.20 per million tokens of query and documents together: a call with a few dozen
short candidates is about $0.0005 and under a second.

## Decision: `jev-1.14`

**For:** a yes or no with a probability, where the design is a threshold: whether a query names
anything the corpus holds (abstention; `lessons.md`, Worked), whether a candidate pair is one
referent.

**Call:** it refuses chat. Your repository already wraps it: `Client.decide(state, questions)` in
`graphrag/llm.py` returns one probability per question name. Underneath, the `openai` client has no
method for this endpoint, so the wrapper calls `client.post("/decisions", body=…, cast_to=dict)`;
plain HTTP works too. `state` is a string holding the
facts to decide on; `questions` maps a name of your own to one question; the reply has one
probability per name.

```json
{"model": "openrouter/typesafe/jev-1.14",
 "state": "Surface A: tool calling (method). Surface B: tool-calling (method). Surface C: tool calls (method).",
 "questions": {"a_b": {"type": "noul", "instructions": "Do A and B name one referent?",
                       "criteria": {"false": "two things", "true": "one thing"}},
               "a_c": {"type": "noul", "instructions": "Do A and C name one referent?",
                       "criteria": {"false": "two things", "true": "one thing"}}}}
```

```json
{"answers": {"a_b": {"type": "noul", "noul": 0.87}, "a_c": {"type": "noul", "noul": 0.78}}}
```

- **Several questions in one call.** Put the shared facts in `state` once and ask every candidate
  as its own named question. That is one call, not one per candidate.
- **The probabilities sit close together.** In the reply above, `tool calling` and `tool-calling`
  (one entity) score 0.87, and `tool calling` and `tool calls` (two entities; `task.md`, 2. Graph
  building) score 0.78. A threshold of 0.5 merges both. Set every threshold on train's labelled
  cases, and set it high where a wrong yes costs more than a wrong no.
- **Write the criteria.** `criteria` says what each answer means; "two things" and "one thing" tell
  it more than "no" and "yes".
- **It judges what `state` says, not what it knows.** Put the evidence in: both descriptions, the
  sentence each name came from.
- **Where it failed:** as an entity filter, and as a verifier, gate or direction check on claims. It
  cannot tell a stated claim from co-occurrence (`lessons.md`, Failed, more than once). No model
  improved graph building over keys and acronyms (`lessons.md`, Worked).

**Cost:** about $0.04 per million input tokens, output free: a call with a long `state` is about
$0.0004 and under half a second.

## The cost of a run

Work it out before you add a call, then check it against the caps the prompt names.

- **A train extraction run** is 6 articles, about 35 sections, and two chat calls per section: about
  70 calls, $0.05 to $0.10, and under a minute at 8 calls in flight. The experiment's cap pays for
  dozens of fresh runs, and a rerun pays only for the calls your change reached.
- **Each call you add per section** adds half of that again. A call per document (a critic) adds
  6. A call per candidate pair or per claim adds hundreds: batch them, or ask the decision model
  several questions at once.
- **The evaluation is larger than train.** Held-out documents are longer and their canon is larger,
  so a stage costs and takes more there than on train (`train.md`, Feedback). Time one section call,
  multiply by sections and calls, divide by concurrency, and keep the total well under the stage's
  time limit: a stage that overruns fails the whole submission.
- **Run calls concurrently.** One call per document or candidate in sequence can overrun the limit
  on its own.
