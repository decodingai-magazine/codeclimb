# Metrics

A hidden runner starts `python3 -m capitals` once in a fresh copy of your repository and sends the evaluation items one line at a time. A hidden scorer compares the answers with the gold capitals.

## Primary metric

- `accuracy`: the share of items whose `capital` matches the gold answer, ignoring case and surrounding spaces. A missing, late or malformed answer counts as wrong.

## Reported metrics

- `latency_query_p50_ms`, `latency_query_p95_ms`: per-answer latency in milliseconds. The first answer is a warm-up and is not counted.
- `latency_total_s`: the summed answer time over all queries, in seconds.
- `cost_usd`, `cost_per_item_usd`, `model_calls`: what the program's model calls cost, in total and per item, and how many it made.

## Hard gates

- `schema_violations` must be 0: answer lines that are not valid JSON, have the wrong `id`, or are missing. A per-answer timeout of 60 seconds or a crash counts as missing.
