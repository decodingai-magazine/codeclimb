# datenorm-hard: the hidden rules

This is the answer key for humans. It is the set of conventions `tools/build_dataset.py` uses for gold answers and that `spec/SPEC.md` deliberately leaves open. It never enters a sandbox: `.dockerignore` excludes it, and it sits outside `spec/`.

Each rule is a choice between two or three plausible readings. The loop can discover the right one by trying the readings on separate branches and comparing `acc_<family>`.

| family | open in the spec | gold convention |
|---|---|---|
| `numeric` | what happens when the locale's reading is impossible | `null`, never the other order (it shows up in `invalid`) |
| `textual_intl` | which languages | French, German and Spanish as in `datenorm`, plus Italian (`4 luglio 2023`, `il 4 lug. 2023`) and Dutch (`4 juli 2023`, `op 4 juli 2023`) |
| `relative` | the exact vocabulary | `datenorm`'s rules: `N months ago` clamps to the month's last day, and `this <weekday>` is in the current Monday-to-Sunday week. On top of that, `a fortnight` is 14 days and `a couple of` days or weeks is 2 |
| `holiday` | which holidays, and in which languages | Western Easter. Moveable feasts are offsets from Easter: Good Friday −2, Easter Monday +1, Ascension +39, Pentecost +49, Whit Monday +50, Ash Wednesday −46, Shrove Tuesday/Mardi Gras −47. US holidays: Thanksgiving is the 4th Thursday of November, Labor Day the 1st Monday of September, Memorial Day the last Monday of May, MLK Day the 3rd Monday of January. Fixed dates come in English, German and French names, plus `Xmas`. `Labor Day` is the US one, while `Fête du Travail`, `Tag der Arbeit` and `May Day` are May 1. A holiday with no year (`Easter plans`) is `null` |
| `nth_weekday` | ordinals and "last" | `first`…`fifth`, `1st`…`5th`, `last`, with full or 3-letter weekday and month names. A fifth weekday that does not exist is `null` |
| `yearless` | which year | No prefix: the next occurrence **on or after** today (today itself counts). `last X`: the most recent occurrence strictly before today. `next X`: the first occurrence strictly after today |
| `multi_date` | which date | The one to act on: the due date, deadline, expiry or valid-until date, or the new date after a reschedule. Never the issue, sent, created or original date. Cue words decide, not word order |
| `fuzzy` | how loose | A misspelling is 1–2 edits (dropped, swapped, doubled or wrong-vowel letters) away from one month of 5+ letters, with no other month as close. Words 3+ edits from every month name and abbreviation (`Augustine 23, 1990`, `Julius 21, 2005`) are `null`. Prefix matching fails them |
| `week_date` | which notations | `YYYY-Www-D`, `YYYYWwwD` and the same with a `T` time, with Monday = 1. Ordinal days: `YYYY-DDD`, `YYYYDDD` and `day N of YYYY`. A week with no day, week 53 in a 52-week year, day 8, or day 366 in a non-leap year is `null` |
| `invalid` | traps | Besides `datenorm`'s traps: name-like words close to month names, `part no. W37-5`, holidays with no year, `the fifth Friday of February <non-leap year>`, and `<Month> <year> newsletter, issue <n>`, where `n` is not a day |

Run `npm run build:dataset:hard` to rebuild the dataset. The seed (20261022) is fixed, so the output is deterministic.
