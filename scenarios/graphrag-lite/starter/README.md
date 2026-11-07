# graphrag

A GraphRAG system: extraction, graph building and retrieval, one command per stage. The spec is in
`/spec/spec/` (`task.md`, `ontology.md`, `train.md`, `runtime.md`); train data is in `/spec/train/` and
`/spec/corpus/`.

```bash
python -m graphrag extraction --root /spec --inputs /spec/train/inputs/extraction.jsonl --out /tmp/extraction.jsonl
```
