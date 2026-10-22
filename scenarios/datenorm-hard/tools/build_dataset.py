"""Build the hidden datenorm-hard dataset (train with 5 stratified folds + test).

Reuses the datenorm generators for the original families and adds holidays,
nth weekdays, year-less dates, multi-date sentences, misspelled months and ISO
week/ordinal dates. The conventions behind each gold answer are listed in
../HIDDEN_RULES.md; SPEC.md deliberately leaves most of them open.

    python3 scenarios/datenorm-hard/tools/build_dataset.py --out scenarios/datenorm-hard/dataset
"""

import argparse
import datetime as dt
import importlib.util
import json
import random
import sys
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "datenorm_base", Path(__file__).resolve().parents[2] / "datenorm" / "tools" / "build_dataset.py"
)
base = importlib.util.module_from_spec(_spec)
sys.dont_write_bytecode = True
_spec.loader.exec_module(base)

TODAY = base.TODAY
EN_MONTHS, EN_ABBR, EN_WEEKDAYS = base.EN_MONTHS, base.EN_ABBR, base.EN_WEEKDAYS
suffix, rand_date, numeric_text, textual_en_text = base.suffix, base.rand_date, base.numeric_text, base.textual_en_text

PER_FAMILY = {"invalid": 40, "holiday": 48, "nth_weekday": 40, "yearless": 40, "multi_date": 40, "fuzzy": 40, "week_date": 40}
PER_FAMILY_DEFAULT = 24
TEST_SHARE = 0.3
N_FOLDS = 5

IT_MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]
NL_MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"]
FR_MONTHS, DE_MONTHS = base.FR_MONTHS, base.DE_MONTHS

# Hand-written examples in SPEC.md; the dataset must not contain them.
SPEC_EXAMPLES = {
    "2019-11-30", "11/30/19", "30.11.2019", "Nov. 30th, 2019", "30 novembre 2019", "the thirtieth of November 2019",
    "next Wednesday", "two weeks ago", "Order 5521 shipped on 11/30/2019, total $84.10", "release 2.4.1 is out",
    "November 31, 2019", "Christmas 2019", "the second Monday of March 2019", "Nov 30", "Novmber 30, 2019",
    "Sent 2019-11-02, due 2019-11-30", "2019-W48-6",
}


def easter(y: int) -> dt.date:
    """Western (Gregorian) Easter Sunday, anonymous Gregorian algorithm."""
    a, b, c = y % 19, y // 100, y % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    return dt.date(y, month, (h + l - 7 * m + 114) % 31 + 1)


def nth_weekday(y: int, m: int, wd: int, n: int) -> dt.date | None:
    """n-th (1..5) or last (n=-1) weekday `wd` (0=Monday) of a month; None when it does not exist."""
    if n == -1:
        last = dt.date(y, m, base.calendar.monthrange(y, m)[1])
        return last - dt.timedelta((last.weekday() - wd) % 7)
    first = dt.date(y, m, 1)
    d = first + dt.timedelta((wd - first.weekday()) % 7 + 7 * (n - 1))
    return d if d.month == m else None


def fixed(month: int, day: int):
    return lambda y: dt.date(y, month, day)


def from_easter(offset: int):
    return lambda y: easter(y) + dt.timedelta(offset)


HOLIDAYS = [
    (["New Year's Day", "Neujahr", "le jour de l'an"], fixed(1, 1)),
    (["New Year's Eve", "Silvester", "la Saint-Sylvestre"], fixed(12, 31)),
    (["Valentine's Day", "Valentinstag", "la Saint-Valentin"], fixed(2, 14)),
    (["St. Patrick's Day", "Saint Patrick's Day"], fixed(3, 17)),
    (["Independence Day", "the Fourth of July"], fixed(7, 4)),
    (["Bastille Day", "la fête nationale"], fixed(7, 14)),
    (["Halloween"], fixed(10, 31)),
    (["All Saints' Day", "Allerheiligen", "la Toussaint"], fixed(11, 1)),
    (["Armistice Day", "Veterans Day"], fixed(11, 11)),
    (["German Unity Day", "Tag der Deutschen Einheit"], fixed(10, 3)),
    (["Christmas Eve", "Heiligabend"], fixed(12, 24)),
    (["Christmas", "Christmas Day", "Xmas", "Noël", "Weihnachten"], fixed(12, 25)),
    (["Boxing Day"], fixed(12, 26)),
    (["Fête du Travail", "Tag der Arbeit", "May Day"], fixed(5, 1)),
    (["Easter", "Easter Sunday", "Ostern", "Pâques"], from_easter(0)),
    (["Good Friday", "Karfreitag", "Vendredi saint"], from_easter(-2)),
    (["Easter Monday", "Ostermontag", "lundi de Pâques"], from_easter(1)),
    (["Ascension Day", "Christi Himmelfahrt", "l'Ascension"], from_easter(39)),
    (["Pentecost", "Whit Sunday", "Pfingsten"], from_easter(49)),
    (["Whit Monday", "Pfingstmontag", "lundi de Pentecôte"], from_easter(50)),
    (["Ash Wednesday", "Aschermittwoch"], from_easter(-46)),
    (["Shrove Tuesday", "Mardi Gras", "Pancake Day"], from_easter(-47)),
    (["Thanksgiving", "Thanksgiving Day"], lambda y: nth_weekday(y, 11, 3, 4)),
    (["Labor Day"], lambda y: nth_weekday(y, 9, 0, 1)),
    (["Memorial Day"], lambda y: nth_weekday(y, 5, 0, -1)),
    (["Martin Luther King Jr. Day", "MLK Day"], lambda y: nth_weekday(y, 1, 0, 3)),
]


def gen_holiday(rng):
    names, fn = rng.choice(HOLIDAYS)
    name, year = rng.choice(names), rng.randint(1985, 2035)
    text = rng.choice([f"{name} {year}", f"{name}, {year}", f"on {name} {year}", f"{name} of {year}", f"{name} in {year}"])
    if rng.random() < 0.15:
        text = text.lower()
    return text, rng.choice(["US", "EU"]), fn(year)


ORD_FORMS = {1: ["first", "1st"], 2: ["second", "2nd"], 3: ["third", "3rd"], 4: ["fourth", "4th"], 5: ["fifth", "5th"], -1: ["last"]}


def gen_nth_weekday(rng):
    y, m, wd = rng.randint(1985, 2035), rng.randint(1, 12), rng.randint(0, 6)
    n = rng.choice([1, 2, 3, 4, -1, -1, 5])
    d = nth_weekday(y, m, wd, n)
    ordw = rng.choice(ORD_FORMS[n])
    wname = rng.choice([EN_WEEKDAYS[wd], EN_WEEKDAYS[wd][:3]])
    mname = rng.choice([EN_MONTHS[m - 1], EN_ABBR[m - 1][:3]])
    text = rng.choice([
        f"the {ordw} {wname} of {mname} {y}",
        f"{ordw} {wname} in {mname} {y}",
        f"the {ordw} {wname} in {mname}, {y}",
        f"{ordw.capitalize()} {wname} of {mname} {y}",
    ])
    return text, rng.choice(["US", "EU"]), d


def next_on_or_after(month: int, day: int, ref: dt.date, strict: bool = False) -> dt.date:
    d = dt.date(ref.year, month, day)
    return d if (d > ref or (d == ref and not strict)) else dt.date(ref.year + 1, month, day)


def last_before(month: int, day: int, ref: dt.date) -> dt.date:
    d = dt.date(ref.year, month, day)
    return d if d < ref else dt.date(ref.year - 1, month, day)


def gen_yearless(rng):
    while True:
        d = rand_date(rng, 2001, 2001)  # a non-leap year: Feb 29 never appears
        if (d.month, d.day) != (TODAY.month, TODAY.day) or rng.random() < 0.3:
            break
    m, day, i = d.month, d.day, d.month - 1
    core = rng.choice([
        f"{EN_MONTHS[i]} {day}", f"{day} {EN_MONTHS[i]}", f"the {day}{suffix(day)} of {EN_MONTHS[i]}",
        f"{EN_ABBR[i][:3]} {day}{suffix(day)}", f"{EN_ABBR[i][:3]}. {day}",
    ])
    mode = rng.random()
    if mode < 0.12:
        text = rng.choice([f"le {day} {FR_MONTHS[i]}", f"am {day}. {DE_MONTHS[i]}"])
        return text, "EU", next_on_or_after(m, day, TODAY)
    if mode < 0.65:
        text, gold = rng.choice([core, f"on {core}", f"see you {core}", f"by {core}"]), next_on_or_after(m, day, TODAY)
    elif mode < 0.85:
        text, gold = rng.choice([f"last {core}", f"since last {core}"]), last_before(m, day, TODAY)
    else:
        text, gold = f"next {core}", next_on_or_after(m, day, TODAY, strict=True)
    return text, rng.choice(["US", "EU"]), gold


def date_mention(d: dt.date, locale: str, rng) -> str:
    kind = rng.choice(["iso", "numeric", "textual"])
    if kind == "iso":
        return d.isoformat()
    if kind == "numeric":
        return numeric_text(d, locale, rng, short_year=False)
    return textual_en_text(d, rng)


MULTI_TEMPLATES = [  # {a}: the date to ignore, {b}: the answer
    "Invoice dated {a}, payment due {b}",
    "Due {b} (issued {a})",
    "Meeting rescheduled from {a} to {b}",
    "Originally planned for {a}, now moved to {b}",
    "Contract signed {a}, expires {b}",
    "Postponed to {b} (was {a})",
    "Order placed {a}; deliver by {b}",
    "Submitted on {a}. Deadline: {b}.",
    "Created {a}, valid until {b}",
    "Launch moved to {b}; the {a} date is cancelled",
]


def gen_multi_date(rng):
    locale = rng.choice(["US", "EU"])
    a = rand_date(rng, 1995, 2030)
    b = a + dt.timedelta(rng.randint(-400, 400))
    while b == a:
        b = a + dt.timedelta(rng.randint(1, 400))
    text = rng.choice(MULTI_TEMPLATES).format(a=date_mention(a, locale, rng), b=date_mention(b, locale, rng))
    return text, locale, b


def edit_distance(s: str, t: str) -> int:
    prev = list(range(len(t) + 1))
    for i, cs in enumerate(s, 1):
        cur = [i]
        for j, ct in enumerate(t, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (cs != ct)))
        prev = cur
    return prev[-1]


MONTH_TOKENS = [m.lower() for m in EN_MONTHS] + [a.lower() for a in EN_ABBR] + ["sep"]
VOWELS = "aeiou"


def typo(word: str, rng) -> str:
    w = list(word)
    op = rng.choice(["drop", "swap", "double", "vowel"])
    i = rng.randint(1, len(w) - 2)
    if op == "drop":
        del w[i]
    elif op == "swap":
        w[i], w[i + 1] = w[i + 1], w[i]
    elif op == "double":
        w.insert(i, w[i])
    else:
        vs = [j for j in range(1, len(w)) if w[j] in VOWELS]
        if vs:
            j = rng.choice(vs)
            w[j] = rng.choice([v for v in VOWELS if v != w[j]])
    return "".join(w)


def gen_fuzzy(rng):
    while True:
        d = rand_date(rng)
        month = EN_MONTHS[d.month - 1]
        if len(month) < 5:  # May, June, July: too short to misspell unambiguously
            continue
        bad = typo(month, rng)
        if rng.random() < 0.3:
            bad = typo(bad, rng)
        dists = sorted((edit_distance(bad.lower(), m.lower()), m) for m in EN_MONTHS)
        if bad.lower() in MONTH_TOKENS or dists[0][1] != month or dists[0][0] == 0 or dists[1][0] - dists[0][0] < 2:
            continue
        break
    text = rng.choice([f"{bad} {d.day}, {d.year}", f"{d.day} {bad} {d.year}", f"{bad} {d.day}{suffix(d.day)} {d.year}"])
    if rng.random() < 0.2:
        text = text.lower()
    return text, rng.choice(["US", "EU"]), d


def gen_week_date(rng):
    y = rng.randint(1990, 2035)
    r = rng.random()
    if r < 0.5:
        weeks = dt.date(y, 12, 28).isocalendar().week
        w, wd = rng.randint(1, weeks), rng.randint(1, 7)
        d = dt.date.fromisocalendar(y, w, wd)
        text = rng.choice([f"{y}-W{w:02d}-{wd}", f"{y}W{w:02d}{wd}", f"{y}-W{w:02d}-{wd}T{rng.randint(0, 23):02d}:00"])
        return text, rng.choice(["US", "EU"]), d
    if r < 0.85:
        n = rng.randint(1, 366 if base.calendar.isleap(y) else 365)
        d = dt.date(y, 1, 1) + dt.timedelta(n - 1)
        text = rng.choice([f"{y}-{n:03d}", f"{y}{n:03d}", f"day {n} of {y}"])
        return text, rng.choice(["US", "EU"]), d
    # Look valid, are not one calendar date.
    no53 = rng.choice([yy for yy in range(1990, 2036) if dt.date(yy, 12, 28).isocalendar().week == 52])
    nonleap = rng.choice([yy for yy in range(1990, 2036) if not base.calendar.isleap(yy)])
    text = rng.choice([f"{y}-W{rng.randint(1, 52):02d}", f"{no53}-W53-{rng.randint(1, 7)}", f"{nonleap}-366", f"{y}-W{rng.randint(1, 52):02d}-8"])
    return text, rng.choice(["US", "EU"]), None


def gen_textual_intl(rng):
    if rng.random() < 0.6:
        return base.gen_textual_intl(rng)
    d = rand_date(rng)
    i = d.month - 1
    if rng.random() < 0.5:
        text = rng.choice([f"{d.day} {IT_MONTHS[i]} {d.year}", f"il {d.day} {IT_MONTHS[i]} {d.year}", f"{d.day} {IT_MONTHS[i][:3]}. {d.year}"])
    else:
        text = rng.choice([f"{d.day} {NL_MONTHS[i]} {d.year}", f"op {d.day} {NL_MONTHS[i]} {d.year}"])
    return text, "EU", d


RELATIVE_EXTRA = [
    ("a fortnight ago", TODAY - dt.timedelta(14)), ("in a fortnight", TODAY + dt.timedelta(14)),
    ("a couple of days ago", TODAY - dt.timedelta(2)), ("in a couple of days", TODAY + dt.timedelta(2)),
    ("a couple of weeks ago", TODAY - dt.timedelta(14)), ("a couple of weeks from now", TODAY + dt.timedelta(14)),
]


def gen_relative(rng):
    if rng.random() < 0.25:
        text, d = rng.choice(RELATIVE_EXTRA)
        return text, rng.choice(["US", "EU"]), d
    return base.gen_relative(rng)


TRAP_WORDS = [
    w for w in ["Junior", "Marchand", "Mayfair", "Augustine", "Octavia", "Decimal", "Novelist", "Janitor", "Marshal", "Junction", "Julius", "Decker"]
    if min(edit_distance(w.lower(), m) for m in MONTH_TOKENS) >= 3
]


def gen_invalid(rng):
    if rng.random() < 0.55:
        return base.gen_invalid(rng)
    y, d = rng.randint(1990, 2030), rng.randint(1, 28)
    text = rng.choice([
        f"{rng.choice(TRAP_WORDS)} {d}, {y}",
        f"Ask {rng.choice(TRAP_WORDS)} about the {d} boxes in {y}",
        f"part no. W{rng.randint(10, 52)}-{rng.randint(1, 7)}",
        f"{rng.choice(['Easter', 'Christmas', 'Thanksgiving'])} plans",
        f"the {rng.choice(['fifth', '5th'])} Friday of February {rng.choice([yy for yy in range(1990, 2031) if not base.calendar.isleap(yy)])}",
        f"{EN_MONTHS[rng.randint(0, 11)]} {y} newsletter, issue {rng.randint(2, 40)}",
    ])
    return text, rng.choice(["US", "EU"]), None


FAMILIES = {
    "iso": base.gen_iso,
    "numeric": base.gen_numeric,
    "textual_en": base.gen_textual_en,
    "textual_intl": gen_textual_intl,
    "ordinal_words": base.gen_ordinal_words,
    "relative": gen_relative,
    "embedded": base.gen_embedded,
    "invalid": gen_invalid,
    "holiday": gen_holiday,
    "nth_weekday": gen_nth_weekday,
    "yearless": gen_yearless,
    "multi_date": gen_multi_date,
    "fuzzy": gen_fuzzy,
    "week_date": gen_week_date,
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=20261022)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    seen: set[tuple[str, str]] = set()
    train, test = [], []
    for family, gen in FAMILIES.items():
        n_family = PER_FAMILY.get(family, PER_FAMILY_DEFAULT)
        items = []
        while len(items) < n_family:
            text, locale, d = gen(rng)
            if (text, locale) in seen or text in SPEC_EXAMPLES:
                continue
            seen.add((text, locale))
            items.append({"text": text, "locale": locale, "family": family, "gold": d.isoformat() if d else None})
        rng.shuffle(items)
        n_test = round(n_family * TEST_SHARE)
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
