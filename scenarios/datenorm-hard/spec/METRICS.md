# Metrics

A hidden runner starts `python3 -m datenorm` once in a fresh copy of your repository. It sends the evaluation items one line at a time and times each answer. A hidden scorer then compares the answers with gold dates.

## Primary metric

- `accuracy`: the share of items whose `date` equals the gold answer exactly. A gold `null` is matched only by `null`. A missing, late or malformed answer counts as wrong.

## Reported metrics

`acc_<family>` is the accuracy on one input family. Watch these numbers: they are the only feedback on which interpretation the evaluation uses.

| family | what it contains |
|---|---|
| `iso` | ISO-like dates, year first |
| `numeric` | numeric dates with the year last, ordered by `locale` |
| `textual_en` | English month names in many layouts |
| `textual_intl` | month names in other European languages |
| `ordinal_words` | day numbers written as English ordinal words |
| `relative` | expressions relative to today |
| `holiday` | named holidays and observances with a year |
| `nth_weekday` | "the n-th / last weekday of a month" |
| `yearless` | a day and a month with no year |
| `multi_date` | sentences that mention two dates |
| `fuzzy` | misspelled month names |
| `week_date` | other ISO 8601 notations for a day |
| `embedded` | one date inside a longer sentence with other numbers |
| `invalid` | date-like text that is not one calendar date (gold is always `null`) |

Also reported:

- `null_precision`: of the items you answered `null`, the share whose gold is `null`.
- `latency_query_p50_ms`, `latency_query_p95_ms`: per-answer latency in milliseconds, from sending a query to receiving its answer. The first answer is a warm-up and is not counted.
- `latency_total_s`: the summed answer time over all queries, in seconds.

## Hard gates

A version that fails a gate is never kept, whatever its accuracy.

- `schema_violations` must be 0. It counts answer lines that are not valid JSON, have the wrong `id`, have a `date` that is neither `null` nor a `YYYY-MM-DD` string, or are missing. A per-answer timeout of 5 seconds or a crash counts as missing.
- `latency_query_p95_ms` must stay under a cap.
