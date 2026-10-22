"""Build the hidden datenorm dataset (train with 5 stratified folds + test).

Deterministic: the same seed always writes the same files.

    python3 scenarios/datenorm/tools/build_dataset.py --out scenarios/datenorm/dataset
"""

import argparse
import calendar
import datetime as dt
import json
import random
import unicodedata
from pathlib import Path

TODAY = dt.date(2024, 6, 15)
PER_FAMILY = 30
TEST_SHARE = 0.3
N_FOLDS = 5

EN_MONTHS = [calendar.month_name[m] for m in range(1, 13)]
EN_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"]
EN_WEEKDAYS = [calendar.day_name[d] for d in range(7)]
FR_MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
FR_ABBR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]
FR_WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
DE_MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"]
DE_ABBR = ["Jan.", "Feb.", "Mär.", "Apr.", "Mai", "Jun.", "Jul.", "Aug.", "Sep.", "Okt.", "Nov.", "Dez."]
ES_MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
ES_ABBR = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sep.", "oct.", "nov.", "dic."]

ORDINAL_WORDS = [
    "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
    "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth",
    "eighteenth", "nineteenth", "twentieth", "twenty-first", "twenty-second", "twenty-third",
    "twenty-fourth", "twenty-fifth", "twenty-sixth", "twenty-seventh", "twenty-eighth",
    "twenty-ninth", "thirtieth", "thirty-first",
]
NUMBER_WORDS = [
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
    "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
]

# Hand-written examples in SPEC.md; the dataset must not contain them.
SPEC_EXAMPLES = {
    "2019-11-30", "11/30/19", "30.11.2019", "Nov. 30th, 2019", "30 novembre 2019", "30. November 2019",
    "the thirtieth of November 2019", "next Wednesday", "two weeks ago",
    "Order 5521 shipped on 11/30/2019, total $84.10", "release 2.4.1 is out", "November 31, 2019",
}


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def suffix(d: int) -> str:
    if 11 <= d % 100 <= 13:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(d % 10, "th")


def rand_date(rng: random.Random, lo: int = 1975, hi: int = 2035) -> dt.date:
    start, end = dt.date(lo, 1, 1).toordinal(), dt.date(hi, 12, 31).toordinal()
    return dt.date.fromordinal(rng.randint(start, end))


def two_digit_ok(year: int) -> bool:
    return 1969 <= year <= 2068


def gen_iso(rng):
    d = rand_date(rng)
    fmt = rng.choice(["%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y%m%d", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M"])
    t = dt.datetime(d.year, d.month, d.day, rng.randint(0, 23), rng.randint(0, 59), rng.randint(0, 59))
    return t.strftime(fmt), rng.choice(["US", "EU"]), d


def numeric_text(d: dt.date, locale: str, rng, *, short_year=None) -> str:
    sep = rng.choice(["/", "-", "."])
    pad = rng.random() < 0.5
    day = f"{d.day:02d}" if pad else str(d.day)
    month = f"{d.month:02d}" if pad else str(d.month)
    if short_year is None:
        short_year = two_digit_ok(d.year) and rng.random() < 0.4
    year = f"{d.year % 100:02d}" if short_year else str(d.year)
    first, second = (month, day) if locale == "US" else (day, month)
    return f"{first}{sep}{second}{sep}{year}"


def gen_numeric(rng):
    d = rand_date(rng)
    if rng.random() < 0.6:  # make the locale matter: both readings are plausible dates
        d = d.replace(day=rng.randint(1, 12))
    locale = rng.choice(["US", "EU"])
    return numeric_text(d, locale, rng), locale, d


def textual_en_text(d: dt.date, rng) -> str:
    m, ab = EN_MONTHS[d.month - 1], EN_ABBR[d.month - 1]
    ab = ab if d.month == 9 and rng.random() < 0.5 else ab[:3]
    wd = EN_WEEKDAYS[d.weekday()]
    options = [
        f"{m} {d.day}, {d.year}",
        f"{d.day} {m} {d.year}",
        f"{ab} {d.day}{suffix(d.day)} {d.year}",
        f"{wd}, {m} {d.day}, {d.year}",
        f"{d.day}{suffix(d.day)} of {m}, {d.year}",
        f"{ab.upper()}-{d.day:02d}-{d.year}",
        f"{d.year} {ab} {d.day:02d}",
        f"{ab}. {d.day}, {d.year}",
        f"{m.lower()} {d.day} {d.year}",
        f"{wd[:3]} {d.day} {ab} {d.year}",
    ]
    return rng.choice(options)


def gen_textual_en(rng):
    d = rand_date(rng)
    return textual_en_text(d, rng), rng.choice(["US", "EU"]), d


def gen_textual_intl(rng):
    d = rand_date(rng)
    i = d.month - 1
    lang = rng.choice(["fr", "de", "es"])
    if lang == "fr":
        day = "1er" if d.day == 1 else str(d.day)
        month = rng.choice([FR_MONTHS[i], FR_ABBR[i]])
        text = rng.choice([
            f"{day} {month} {d.year}",
            f"le {day} {month} {d.year}",
            f"{FR_WEEKDAYS[d.weekday()]} {day} {month} {d.year}",
        ])
    elif lang == "de":
        month = rng.choice([DE_MONTHS[i], DE_ABBR[i]])
        text = rng.choice([f"{d.day}. {month} {d.year}", f"am {d.day}. {month} {d.year}", f"{d.day:02d}. {month} {d.year}"])
    else:
        month = rng.choice([ES_MONTHS[i], ES_ABBR[i]])
        text = rng.choice([f"{d.day} de {month} de {d.year}", f"{d.day} {month} {d.year}", f"{d.day:02d}-{month.rstrip('.')}-{d.year}"])
    if rng.random() < 0.3:
        text = strip_accents(text)
    if rng.random() < 0.2:
        text = text.upper()
    return text, "EU", d


def gen_ordinal_words(rng):
    d = rand_date(rng)
    word = ORDINAL_WORDS[d.day - 1]
    if "-" in word and rng.random() < 0.5:
        word = word.replace("-", " ")
    m = EN_MONTHS[d.month - 1]
    text = rng.choice([f"the {word} of {m} {d.year}", f"{m} {word}, {d.year}", f"{m} {word} {d.year}", f"The {word} of {m}, {d.year}"])
    return text, rng.choice(["US", "EU"]), d


def add_months(d: dt.date, n: int) -> dt.date:
    idx = d.year * 12 + (d.month - 1) + n
    year, month = divmod(idx, 12)
    month += 1
    return dt.date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def relative_pool():
    pool = [
        ("today", TODAY), ("yesterday", TODAY - dt.timedelta(1)), ("tomorrow", TODAY + dt.timedelta(1)),
        ("the day before yesterday", TODAY - dt.timedelta(2)), ("the day after tomorrow", TODAY + dt.timedelta(2)),
        ("a week ago", TODAY - dt.timedelta(7)), ("a week from today", TODAY + dt.timedelta(7)),
    ]
    for n in range(1, 21):
        word = NUMBER_WORDS[n - 1]
        for num in (str(n), word):
            pool += [
                (f"{num} days ago", TODAY - dt.timedelta(n)),
                (f"in {num} days", TODAY + dt.timedelta(n)),
                (f"{num} days from now", TODAY + dt.timedelta(n)),
            ]
            if n <= 8:
                pool += [
                    (f"{num} weeks ago", TODAY - dt.timedelta(7 * n)),
                    (f"in {num} weeks", TODAY + dt.timedelta(7 * n)),
                    (f"{num} weeks from today", TODAY + dt.timedelta(7 * n)),
                ]
            if n <= 12:
                pool += [(f"{num} months ago", add_months(TODAY, -n)), (f"in {num} months", add_months(TODAY, n))]
    monday = TODAY - dt.timedelta(TODAY.weekday())
    for i, wd in enumerate(EN_WEEKDAYS):
        nxt = TODAY + dt.timedelta((i - TODAY.weekday() - 1) % 7 + 1)
        last = TODAY - dt.timedelta((TODAY.weekday() - i - 1) % 7 + 1)
        pool += [(f"next {wd}", nxt), (f"last {wd}", last), (f"this {wd}", monday + dt.timedelta(i))]
    return pool


RELATIVE_POOL = relative_pool()


def gen_relative(rng):
    text, d = rng.choice(RELATIVE_POOL)
    if rng.random() < 0.25:
        text = text[0].upper() + text[1:]
    return text, rng.choice(["US", "EU"]), d


def gen_embedded(rng):
    d = rand_date(rng, 1990, 2030)
    locale = rng.choice(["US", "EU"])
    kind = rng.choice(["iso", "numeric", "textual"])
    if kind == "iso":
        date_text = d.isoformat()
    elif kind == "numeric":
        date_text = numeric_text(d, locale, rng, short_year=False)
    else:
        date_text = textual_en_text(d, rng)
    n, amt = rng.randint(1000, 99999), f"{rng.randint(5, 9999)}.{rng.randint(0, 99):02d}"
    hh, mm = rng.randint(1, 12), rng.choice(["00", "15", "30", "45"])
    templates = [
        f"Invoice #{n} issued on {date_text} for ${amt}",
        f"Meeting moved to {date_text} at {hh}:{mm}",
        f"Call 555-{rng.randint(1000, 9999)} before {date_text}.",
        f"v{rng.randint(1, 9)}.{rng.randint(0, 20)}.{rng.randint(0, 30)} released {date_text}",
        f"Flight LH{rng.randint(100, 999)} departs {date_text}, gate {rng.randint(1, 60)}",
        f"Room {rng.randint(100, 499)}: inspection on {date_text} ({rng.randint(2, 9)} people)",
        f"Paid {amt} EUR on {date_text}, ref {n}",
    ]
    return rng.choice(templates), locale, d


def gen_invalid(rng):
    year = rng.randint(1990, 2030)
    non_leap = rng.choice([y for y in range(1990, 2031) if not calendar.isleap(y)])
    options = [
        (f"{year}-02-30", "US"),
        (f"February 29, {non_leap}", "US"),
        (f"31/04/{year}", "EU"),
        (f"13/{rng.randint(1, 28):02d}/{year}", "US"),
        (f"04/31/{year}", "US"),
        (f"31.06.{year}", "EU"),
        (f"{year}-13-{rng.randint(1, 28):02d}", "EU"),
        (f"Feb 30th {year}", "US"),
        (f"30 février {year}", "EU"),
        (f"29. Februar {non_leap}", "EU"),
        (f"version {rng.randint(1, 9)}.{rng.randint(0, 9)}.{rng.randint(0, 9)}", "US"),
        (f"call 555-{rng.randint(1000, 9999)}", "EU"),
        (f"{EN_MONTHS[rng.randint(0, 11)]} {year}", "US"),
        (f"see you at {rng.randint(1, 12)}:{rng.choice(['00', '30'])}", "EU"),
        ("no date in this sentence", "US"),
        (f"Q{rng.randint(1, 4)} {year} results", "EU"),
        (f"{rng.randint(32, 99)}/{rng.randint(1, 12)}/{year}", "EU"),
    ]
    text, locale = rng.choice(options)
    return text, locale, None


FAMILIES = {
    "iso": gen_iso,
    "numeric": gen_numeric,
    "textual_en": gen_textual_en,
    "textual_intl": gen_textual_intl,
    "ordinal_words": gen_ordinal_words,
    "relative": gen_relative,
    "embedded": gen_embedded,
    "invalid": gen_invalid,
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=20261021)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    seen: set[tuple[str, str]] = set()
    train, test = [], []
    for family, gen in FAMILIES.items():
        items = []
        while len(items) < PER_FAMILY:
            text, locale, d = gen(rng)
            if (text, locale) in seen or text in SPEC_EXAMPLES:
                continue
            seen.add((text, locale))
            items.append({"text": text, "locale": locale, "family": family, "gold": d.isoformat() if d else None})
        rng.shuffle(items)
        n_test = round(PER_FAMILY * TEST_SHARE)
        for i, item in enumerate(items[n_test:]):
            train.append({**item, "fold": i % N_FOLDS})
        test.extend(items[:n_test])
    for i, item in enumerate(train):
        item["id"] = f"tr-{i:03d}"
    for i, item in enumerate(test):
        item["id"] = f"te-{i:03d}"
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    keys = ["id", "text", "locale", "family", "gold"]
    with open(out / "train.jsonl", "w") as f:
        for item in train:
            f.write(json.dumps({k: item[k] for k in keys + ["fold"]}, ensure_ascii=False) + "\n")
    with open(out / "test.jsonl", "w") as f:
        for item in test:
            f.write(json.dumps({k: item[k] for k in keys}, ensure_ascii=False) + "\n")
    print(f"train={len(train)} test={len(test)} -> {out}")


if __name__ == "__main__":
    main()
