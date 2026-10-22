# datenorm: normalize messy date mentions to ISO dates

Build a command-line program that reads free-text date mentions and returns the calendar date each one refers to, as `YYYY-MM-DD`, or `null` when the text does not pin down one valid calendar date.

This specification describes the kinds of input you will see, not every rule behind the expected answers. Where it leaves a choice open, pick the reading a careful human would, and use the per-family metrics (see `METRICS.md`) to find out which reading the evaluation expects.

## Program contract

- Language: Python 3.14, **standard library only**. There is no network access: you cannot `pip install` anything.
- Entry point: `python3 -m datenorm`, run from the repository root.
- Input: JSON Lines on stdin. Each line is one item: `{"id": "<string>", "text": "<string>", "locale": "US" | "EU"}`.
- Output: for every input line, write exactly one JSON line to stdout, in input order: `{"id": "<same id>", "date": "YYYY-MM-DD"}` or `{"id": "<same id>", "date": null}`.
- The caller sends one line, then waits for its answer before sending the next. Flush stdout after every line and do not wait for end of input before answering.
- Never crash on bad input: unparseable text gets `"date": null`. Write nothing else to stdout (use stderr for logs).
- Latency: each answer should take well under 50 ms. Do not do heavy work per line.

The starter repository already contains a stub that answers `null` for everything.

## What the input looks like

The reference date ("today") is **2024-06-15** (a Saturday).

- **ISO-like dates**, year first, possibly with a time part that is ignored. Other ISO 8601 calendar notations can appear too.
- **Numeric dates with the year last.** The `locale` field decides the order: `US` is month first, `EU` is day first. A two-digit year `YY` means `20YY` when `YY` ≤ 68, else `19YY`.
- **Month names** in English and several other Western European languages, abbreviated or not, in any letter case, accents optional. Weekday names and ordinal suffixes can appear.
- **Day numbers written as English ordinal words.**
- **Relative expressions** in everyday English, counted from today.
- **Calendar expressions**: named public holidays and observances of a given year, and expressions such as "the second Monday of March".
- **Dates with no year.**
- **Sentences with more than one date.** Return the date the sentence is really about.
- **Typos.** People misspell month names.
- **Dates inside longer text**, among invoice numbers, amounts, times, phone numbers and version strings. Numbers that are not part of a date must not be read as one.

The answer is `null` when there is no date, when the date does not exist (`February 29, 2023`), or when the text is date-like but does not name one day (a version string, a time, a month and year with no day).

## Examples

These are illustrative and are not taken from the hidden evaluation data.

| text | locale | date |
|---|---|---|
| `2019-11-30` | US | `2019-11-30` |
| `11/30/19` | US | `2019-11-30` |
| `30.11.2019` | EU | `2019-11-30` |
| `Nov. 30th, 2019` | EU | `2019-11-30` |
| `30 novembre 2019` | EU | `2019-11-30` |
| `the thirtieth of November 2019` | US | `2019-11-30` |
| `next Wednesday` | US | `2024-06-19` |
| `two weeks ago` | EU | `2024-06-01` |
| `Christmas 2019` | US | `2019-12-25` |
| `the second Monday of March 2019` | EU | `2019-03-11` |
| `Nov 30` | US | `2024-11-30` |
| `Sent 2019-11-02, due 2019-11-30` | US | `2019-11-30` |
| `Novmber 30, 2019` | US | `2019-11-30` |
| `2019-W48-6` | EU | `2019-11-30` |
| `Order 5521 shipped on 11/30/2019, total $84.10` | US | `2019-11-30` |
| `release 2.4.1 is out` | US | `null` |
| `November 31, 2019` | US | `null` |

## How you are evaluated

See `METRICS.md`. You never see the evaluation data: write code that generalizes, not code that memorizes examples.
