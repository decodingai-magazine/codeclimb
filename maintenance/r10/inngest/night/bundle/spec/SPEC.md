# datenorm: normalize messy date mentions to ISO dates

Build a command-line program that reads free-text date mentions and returns the calendar date each one refers to, as `YYYY-MM-DD`, or `null` when the text does not name exactly one valid calendar date.

## Program contract

- Language: Python 3.14, **standard library only**. There is no network access: you cannot `pip install` anything.
- Entry point: `python3 -m datenorm`, run from the repository root.
- Input: JSON Lines on stdin. Each line is one item: `{"id": "<string>", "text": "<string>", "locale": "US" | "EU"}`.
- Output: for every input line, write exactly one JSON line to stdout, in input order: `{"id": "<same id>", "date": "YYYY-MM-DD"}` or `{"id": "<same id>", "date": null}`.
- The caller sends one line, then waits for its answer before sending the next. Flush stdout after every line and do not wait for end of input before answering.
- Never crash on bad input: unparseable text gets `"date": null`. Write nothing else to stdout (use stderr for logs).
- Latency: each answer should take well under 50 ms. Do not do heavy work per line.

The starter repository already contains a stub that answers `null` for everything.

## Interpretation rules

The reference date ("today") is **2024-06-15** (a Saturday). It only matters for relative expressions.

### ISO-like dates

Year first, always year-month-day: `2023-07-04`, `2023/07/04`, `2023.07.04`, `20230704`, `2023-07-04T13:45:00Z`, `2023-07-04 08:30`. A time part is ignored.

### Numeric dates with the year last

The `locale` field decides the order:

- `US`: month first. `07/04/2023` → 2023-07-04.
- `EU`: day first. `04/07/2023` → 2023-07-04.

Separators can be `/`, `-` or `.`, with or without leading zeros. A two-digit year `YY` maps to `20YY` when `YY` ≤ 68, else to `19YY` (`7/4/23` → 2023, `7/4/75` → 1975). If the locale's reading is not a valid date (for example month 13), the answer is `null`. Do not fall back to the other order.

### Month names

Month names and their common abbreviations can appear in **English, French, German or Spanish**, in any letter case, with or without a trailing period (`Sept.`, `févr.`). Accents can be missing (`fevrier`, `Marz`). Weekday names can appear and are ignored. English ordinal suffixes (`1st`, `2nd`, `3rd`, `4th`) and the French `1er` mark the day.

Examples of accepted shapes: `July 4, 2023`, `4 July 2023`, `Jul 4th 2023`, `Tuesday, July 4, 2023`, `4th of July, 2023`, `JUL-04-2023`, `2023 Jul 04`, `4 juillet 2023`, `1er mars 2022`, `4. Juli 2023`, `4 de julio de 2023`.

### Days written as words

English day numbers can be written as ordinal words, with or without a hyphen: `the twenty-first of March 2021`, `May first, 2020`, `March thirty first 2021`. The year is always written in digits.

### Relative expressions (English only)

Relative to today, 2024-06-15:

- `today`, `yesterday`, `tomorrow`, `the day before yesterday`, `the day after tomorrow`
- `N days|weeks ago`, `in N days|weeks`, `N days|weeks from now|from today`. `N` can be digits or an English number word from one to twenty (`three weeks ago`), and `a` means 1 (`a week ago`).
- `N months ago`, `in N months`: same day number in the target month, clamped to the last day of that month.
- `next <weekday>`: the first such weekday strictly after today. `last <weekday>`: the most recent such weekday strictly before today. `this <weekday>`: that weekday in the current Monday-to-Sunday week.

### Dates inside longer text

The text can be a sentence that contains one date among other numbers: invoice numbers, amounts, times, phone numbers, version strings. Extract the date. Numbers that are not part of a date must not be read as one.

### When the answer is null

- No date in the text.
- The date does not exist (`2023-02-30`, `February 29, 2023`, `31/04/2022` with `EU`).
- Something date-like that is not a calendar date: versions (`1.2.3`), phone numbers, times only, a month and year with no day (`March 2023`).

## Examples

These are illustrative and are not taken from the hidden evaluation data.

| text | locale | date |
|---|---|---|
| `2019-11-30` | US | `2019-11-30` |
| `11/30/19` | US | `2019-11-30` |
| `30.11.2019` | EU | `2019-11-30` |
| `Nov. 30th, 2019` | EU | `2019-11-30` |
| `30 novembre 2019` | EU | `2019-11-30` |
| `30. November 2019` | EU | `2019-11-30` |
| `the thirtieth of November 2019` | US | `2019-11-30` |
| `next Wednesday` | US | `2024-06-19` |
| `two weeks ago` | EU | `2024-06-01` |
| `Order 5521 shipped on 11/30/2019, total $84.10` | US | `2019-11-30` |
| `release 2.4.1 is out` | US | `null` |
| `November 31, 2019` | US | `null` |

## How you are evaluated

See `METRICS.md`. You never see the evaluation data: write code that generalizes from these rules, not code that memorizes examples.
