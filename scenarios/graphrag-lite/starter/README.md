# graphrag

A GraphRAG system: extraction, graph building and retrieval, one command per stage. The spec is in
`/spec/spec/` (`task.md`, `ontology.md`, `train.md`, `runtime.md`); train data is in `/spec/train/` and
`/spec/corpus/`.

```bash
python -m graphrag extraction --root /spec --inputs /spec/train/inputs/extraction.jsonl --out /tmp/extraction.jsonl
python -m graphrag graph      --root /spec --inputs /spec/train/inputs/graph.jsonl      --out /tmp/graph.jsonl
python -m graphrag retrieval  --root /spec --inputs /spec/train/inputs/retrieval.jsonl  --out /tmp/retrieval.jsonl --graph /spec/train/graph.json
```

The layout is the reference architecture of `task.md`, wired end to end and runnable as it is:

| path | what |
|---|---|
| `config.toml` | every threshold, size and model name; `GRAPHRAG_CONFIG` names another file |
| `graphrag/contracts.py` | the prediction rows (unknown fields forbidden, as the evaluator does) and the reply models (strict envelope, lenient rows, salvage of a truncated reply) |
| `graphrag/llm.py` | chat, embeddings, rerank and decisions through the endpoint; retries, the 402 stop, concurrency |
| `graphrag/extraction/` | frontmatter off, sections at headings, an entities call then a claims call per section with the canon of known entities, the deterministic filter, the optional critic (`extraction.critic`) |
| `graphrag/prompts/ontology.md` | the ontology, which is the extractor's system prompt |
| `graphrag/graph/` | the scorer's normalized key (`keys.py`), the resolver chain (exact, alias; `nominations` is the hook for acronym, fuzzy and embedding candidates), the assignments |
| `graphrag/retrieval/` | the gold graph in Ladybug (`store.py`), anchors by key (`anchors.py`), one Cypher template per query shape (`queries.py`), the ranked envelope (`rank.py`) |
| `fewshot.json` | the train items the system uses, even if none |

What it does out of the box: extraction calls the chat model per section with the ontology as the
prompt and folds the rows; graph building merges on name and alias keys and nothing else; retrieval
returns the anchors' edges, the paths and common neighbours between two anchors, and the documents
that mention them, or an empty envelope when no anchor resolves. Rejected extraction rows go to
`rejected.jsonl` beside the output.

Score a run on train with the bundle's scorers (`/spec/spec/train.md`, Scoring your work on train).
