"""Runs inside the analysis container: measure the build at /app (read-only) with the pinned tools in /tools.

    python3 /tools/measure.py <context.json> <metrics.json>

The context (from code_metrics.py) names the given inputs, the build spec's dependency table and the stack SDK.
Every tool is filtered through one scope, `scope()`: the build's TypeScript and JavaScript without the given inputs,
the Next.js app and generated files. A tool that fails gives null and its error, never a zero.
"""

import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

APP = Path("/app")
TOOLS = Path("/tools")
CODE = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs")
GENERATED = frozenset({"node_modules", ".git", ".next", "out", "dist", "build", "coverage", "generated", ".venv", "__pycache__"})
TEST_DIRS = frozenset({"test", "tests", "__tests__"})


def files_of(root: Path) -> list[str]:
    """Every file under `root` but symlinks and generated files (under a GENERATED or runs folder, or a .tsbuildinfo)."""
    out = []
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root)
        if p.is_file() and not p.is_symlink() and not (
            any(d in GENERATED or d.startswith("runs-") for d in rel.parts[:-1]) or rel.name.endswith(".tsbuildinfo")
        ):
            out.append(rel.as_posix())
    return out


def next_app(files: list[str], deps: dict[str, str]) -> set[str]:
    """The Next.js app: a folder holding `next.config.*` other than the build's root, wholly; at the root, the config,
    `next-env.d.ts` and the `app/` and `pages/` folders (also under `src/`)."""
    configs = [f for f in files if f.rsplit("/", 1)[-1].startswith("next.config.")]
    roots = {f.rsplit("/", 1)[0] if "/" in f else "" for f in configs}
    if not roots and "next" in deps:
        roots = {""}
    out = set()
    for root in roots:
        pre = f"{root}/" if root else ""
        if root:
            out |= {f for f in files if f.startswith(pre)}
            continue
        dirs = tuple(f"{d}/" for d in ("app", "pages", "src/app", "src/pages"))
        out |= {f for f in files if f.startswith(dirs) or f in ("next-env.d.ts", *configs)}
    return out


def scope(ctx: dict, deps: dict[str, str]) -> tuple[list[str], dict[str, list[str]]]:
    """(the measured files, the excluded ones by reason)."""
    files = files_of(APP)
    given = {f for f in files if f.split("/", 1)[0] in ctx["given_dirs"] or f in ctx["given_files"]}
    nxt = next_app(files, deps) - given
    measured = [f for f in files if f.endswith(CODE) and f not in given and f not in nxt]
    return measured, {"given": sorted(f for f in given if f.endswith(CODE)), "next_app": sorted(nxt)}


def is_test(f: str) -> bool:
    parts = f.split("/")
    return bool(TEST_DIRS.intersection(parts[:-1])) or any(t in parts[-1] for t in (".test.", ".spec."))


def run(cmd: list[str], cwd: Path, timeout: float = 900) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout + p.stderr
    except subprocess.TimeoutExpired as e:
        return -1, f"timed out after {timeout:.0f}s\n{(e.stdout or b'')[-2000:]!r}"


def cloc(work: Path, files: list[str]) -> dict[str, dict]:
    """Per file: code and comment lines. Identical files count each time (cloc skips them by default)."""
    lst = work / ".analysis-files.txt"
    lst.write_text("\n".join(files) + "\n")
    code, out = run(["cloc", "--by-file", "--json", "--quiet", "--skip-uniqueness", f"--list-file={lst}"], work)
    data = json.loads(out[out.index("{"):]) if code == 0 and "{" in out else None
    if data is None:
        raise RuntimeError(f"cloc failed: {out[-1000:]}")
    return {k.removeprefix("./"): v for k, v in data.items() if k not in ("header", "SUM")}


def size(files: list[str], lines: dict[str, dict]) -> dict:
    src = [f for f in files if not is_test(f)]
    return {
        "code_lines": sum(lines.get(f, {}).get("code", 0) for f in files),
        "comment_lines": sum(lines.get(f, {}).get("comment", 0) for f in files),
        "test_code_lines": sum(lines.get(f, {}).get("code", 0) for f in files if is_test(f)),
        "files": len(files),
        "modules": len({f.rsplit("/", 1)[0] if "/" in f else "." for f in src}),
    }


# An import or re-export clause holds at most one brace group and no parentheses, so a clause never runs on into code.
STATIC = re.compile(r"^\s*(?:import|export)\b([^;(){}]*?(?:\{[^}]*\}[^;(){}]*?)?)\bfrom\s*[\"']([^\"']+)[\"']", re.M | re.S)
BARE = re.compile(r"(?:^\s*import\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)[\"']([^\"']+)[\"']", re.M)


def imports(text: str) -> list[tuple[str, str]]:
    """(module, symbol) per imported name: a named import by its own name, `default`, or `*` for a namespace."""
    out = []
    for clause, mod in STATIC.findall(text):
        clause = re.sub(r"^\s*type\b", "", clause)
        named = re.search(r"\{([^}]*)\}", clause)
        for part in (named.group(1).split(",") if named else []):
            name = re.sub(r"^\s*type\s+", "", part).split(" as ")[0].strip()
            if name:
                out.append((mod, name))
        rest = re.sub(r"\{[^}]*\}", "", clause)
        if "*" in rest:
            out.append((mod, "*"))
        elif re.search(r"[A-Za-z_$]", rest.replace("export", "")):
            out.append((mod, "default"))
        if not named and not rest.strip(" ,\n"):
            out.append((mod, "*"))  # export * from
    out += [(mod, "*") for mod in BARE.findall(text)]
    return out


def glue(ctx: dict, work: Path, files: list[str], lines: dict[str, dict]) -> dict:
    sdk = re.compile(ctx["sdk"])
    src = [f for f in files if not is_test(f)]
    symbols, glue_files = set(), []
    for f in src:
        found = [(m, s) for m, s in imports((work / f).read_text(errors="replace")) if sdk.match(m)]
        if found:
            glue_files.append(f)
            symbols |= {f"{m}:{s}" for m, s in found}
    code = {f: lines.get(f, {}).get("code", 0) for f in src}
    return {
        "glue_files": glue_files,
        "glue_lines": sum(code[f] for f in glue_files),
        "domain_lines": sum(v for f, v in code.items() if f not in glue_files),
        "sdk_symbols": sorted(symbols),
        "n_sdk_symbols": len(symbols),
    }


def eslint(work: Path, config: str, files: list[str]) -> tuple[list[dict], list[str]]:
    """(every message, the files ESLint could not parse). Inline config is off: a build's disable comments count
    for nothing. Raises when ESLint itself fails."""
    if not files:
        return [], []
    code, out = run(
        [str(TOOLS / "node_modules/.bin/eslint"), "--config", str(TOOLS / config), "--no-inline-config",
         "--no-warn-ignored", "--format", "json", "--", *files],
        work,
    )
    if code not in (0, 1) or "[" not in out:
        raise RuntimeError(f"eslint exited {code}: {out[-1500:]}")
    results = json.loads(out[out.index("["):out.rindex("]") + 1])
    messages, fatal = [], []
    for r in results:
        rel = Path(r["filePath"]).relative_to(work).as_posix()
        for m in r["messages"]:
            if m.get("fatal"):
                fatal.append(f"{rel}: {m.get('message')}")
            else:
                messages.append({**m, "file": rel})
    return messages, fatal


def _ban(directive: str):
    return lambda m: m["ruleId"] == "@typescript-eslint/ban-ts-comment" and f"@{directive}" in m["message"]


ESCAPES = {
    "any": lambda m: m["ruleId"] == "@typescript-eslint/no-explicit-any",
    "non_null": lambda m: m["ruleId"] == "@typescript-eslint/no-non-null-assertion",
    "as_unknown_as": lambda m: m["ruleId"] == "no-restricted-syntax",
    "ts_ignore": _ban("ts-ignore"),
    "ts_expect_error": _ban("ts-expect-error"),
    "ts_nocheck": _ban("ts-nocheck"),
}


def per_kloc(n: int | None, code_lines: int) -> float | None:
    return round(1000 * n / code_lines, 1) if n is not None and code_lines else None


def escapes_and_complexity(work: Path, files: list[str], code_lines: int) -> tuple[dict, dict]:
    """Type escapes and per-function complexity, from one syntax-only ESLint run (eslint.measure.mjs)."""
    try:
        messages, fatal = eslint(work, "eslint.measure.mjs", files)
    except RuntimeError as e:
        return ({**dict.fromkeys([*ESCAPES, "total", "per_kloc"]), "error": str(e)},
                {**dict.fromkeys(["functions", "mean", "max", "over_10"]), "error": str(e)})
    error = "; ".join(fatal) or None
    esc: dict = {k: sum(1 for m in messages if f(m)) for k, f in ESCAPES.items()}
    esc["total"] = sum(esc.values())
    esc["per_kloc"] = per_kloc(esc["total"], code_lines)
    esc["error"] = error
    values = [int(x) for m in messages if m["ruleId"] == "complexity" for x in re.findall(r"complexity of (\d+)", m["message"])]
    cx = {
        "functions": len(values),
        "mean": round(sum(values) / len(values), 2) if values else None,
        "max": max(values, default=None),
        "over_10": sum(v > 10 for v in values),
        "error": error,
    }
    return esc, cx


def install(work: Path) -> dict:
    """The build's own packages, lifecycle scripts off; no lockfile falls back to `npm install`."""
    cmd = ["npm", "ci" if (work / "package-lock.json").exists() else "install", "--ignore-scripts", "--no-audit", "--no-fund"]
    code, out = run(cmd, work)
    return {"command": " ".join(cmd), "ok": code == 0, "error": None if code == 0 else out[-1500:]}


def ruleset(ctx: dict, work: Path, files: list[str], code_lines: int) -> dict:
    """The benchmark's ruleset (eslint.ruleset.mjs), type-checked over a project of exactly the measured files that
    extends the build's own tsconfig (the given one if the build has none)."""
    ts = [f for f in files if f.endswith((".ts", ".tsx", ".mts", ".cts"))]
    base = "./tsconfig.json"
    if not (work / "tsconfig.json").exists():
        base = "./.analysis.base.tsconfig.json"
        (work / base).write_text(ctx["given_tsconfig"])
    project = {"extends": base, "compilerOptions": {"noEmit": True, "incremental": False}, "files": ts, "include": []}
    (work / ".analysis.tsconfig.json").write_text(json.dumps(project))
    try:
        messages, fatal = eslint(work, "eslint.ruleset.mjs", ts)
    except RuntimeError as e:
        return {"violations": None, "per_kloc": None, "by_rule": None, "error": str(e)}
    by_rule: dict[str, int] = {}
    for m in messages:
        by_rule[m["ruleId"]] = by_rule.get(m["ruleId"], 0) + 1
    return {"violations": len(messages), "per_kloc": per_kloc(len(messages), code_lines),
            "by_rule": dict(sorted(by_rule.items())), "error": "; ".join(fatal) or None}


def dependencies(ctx: dict, pkg: dict) -> dict:
    """Against the build spec's dependency table (not the given package.json)."""
    table = ctx["dependency_table"]
    deps = {k: v for field in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies")
            for k, v in (pkg.get(field) or {}).items()}
    return {
        "beyond_table": sorted(d for d in deps if d not in table),
        "other_version": {d: {"build": v, "table": table[d]} for d, v in sorted(deps.items()) if d in table and v != table[d]},
    }


def jsonc(text: str) -> dict | None:
    """tsconfig.json: JSON with comments and trailing commas. A comment marker inside a string stays."""
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c == '"':
            j = i + 1
            while j < n and text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            out.append(text[i:j + 1])
            i = j + 1
        elif text.startswith("//", i):
            i = text.find("\n", i) if "\n" in text[i:] else n
        elif text.startswith("/*", i):
            i = text.find("*/", i + 2) + 2 if "*/" in text[i + 2:] else n
        else:
            out.append(c)
            i += 1
    try:
        data = json.loads(re.sub(r",(\s*[}\]])", r"\1", "".join(out)))
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


# Compiler options that, turned off, loosen type checking. `strict` covers the strict family when they are unset.
STRICTNESS = ("strict", "noImplicitAny", "strictNullChecks", "strictFunctionTypes", "strictBindCallApply",
              "strictPropertyInitialization", "noImplicitThis", "alwaysStrict", "useUnknownInCatchVariables",
              "noUncheckedIndexedAccess", "exactOptionalPropertyTypes", "noImplicitReturns", "noImplicitOverride",
              "noFallthroughCasesInSwitch", "isolatedModules", "verbatimModuleSyntax")


def hardcoded_thresholds(ctx: dict, work: Path, files: list[str]) -> dict:
    """A code check, deterministic: lines of the build's non-test code where a metric name the night configs set under
    `thresholds:` or `gates:` meets a number (`accuracy >= 0.9`, `accuracy: 0.97`, `0.9 <= accuracy`). The configs
    set these values, so a hit is a threshold written into the code instead of read from the config."""
    names = ctx.get("threshold_names") or []
    if not names:
        return {"hits": [], "n": 0, "names": names}
    name = "|".join(map(re.escape, names))
    num = r"-?\d+(?:\.\d+)?"
    op = r"(?:[:=]|[<>]=?|[!=]==?)"
    pattern = re.compile(rf"\b(?:{name})\b['\"]?\s*{op}\s*{num}\b|\b{num}\s*(?:[<>]=?|[!=]==?)\s*[\w.]*\b(?:{name})\b")
    hits = []
    for f in files:
        if is_test(f):
            continue
        for i, line in enumerate((work / f).read_text(errors="replace").splitlines(), 1):
            if pattern.search(line) and not line.lstrip().startswith(("//", "*", "/*")):
                hits.append(f"{f}:{i}")
    return {"hits": hits, "n": len(hits), "names": names}


def tsconfig(ctx: dict) -> dict:
    """The given tsconfig.json against the build's: its sha256 (the spec's test), which options changed and which
    strictness options were turned off or removed."""
    path = APP / "tsconfig.json"
    data = path.read_bytes() if path.exists() else b""
    given = (jsonc(ctx["given_tsconfig"]) or {}).get("compilerOptions") or {}
    build = (jsonc(data.decode(errors="replace")) or {}).get("compilerOptions") or {}
    changed = {k: [given.get(k), build.get(k)] for k in sorted({*given, *build}) if given.get(k) != build.get(k)}
    return {
        "sha256_matches_given": hashlib.sha256(data).hexdigest() == ctx["given_tsconfig_sha256"],
        "weakened": [k for k in STRICTNESS if given.get(k) is True and build.get(k) is not True],
        "changed_options": changed,
    }


def practices(ctx: dict, pkg: dict, work: Path) -> dict:
    """Flags, and whether the build's own lint and format-check scripts pass. CI and pre-commit hooks are not run in
    the container (no CI runner, no commit to hook): their passes are null, with the reason in `not_run`."""
    files = set(files_of(APP)) | {p.relative_to(APP).as_posix() for p in APP.glob(".git/hooks/*") if not p.name.endswith(".sample")}
    scripts = pkg.get("scripts") or {}
    deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}

    def passes(*candidates: str) -> bool | None:
        script = next((s for s in candidates if s in scripts), None)
        return None if script is None else run(["npm", "run", "-s", script], work, timeout=600)[0] == 0

    agents = APP / "AGENTS.md"
    return {
        "ci": any(f.startswith((".github/workflows/", ".circleci/", ".buildkite/")) or f in (".gitlab-ci.yml", "azure-pipelines.yml") for f in files),
        "ci_passes": None,
        "pre_commit": any(f.startswith((".husky/", ".git/hooks/")) for f in files)
                      or bool({".pre-commit-config.yaml", "lefthook.yml", ".lefthook.yml"} & files)
                      or any(k in pkg for k in ("simple-git-hooks", "lint-staged")),
        "pre_commit_passes": None,
        "not_run": "CI and pre-commit hooks are not run inside the analysis container: their passes are null",
        "linter": any(f.split("/")[-1].startswith(("eslint.config.", ".eslintrc", "biome.json", ".oxlintrc", "oxlint")) for f in files)
                  or any(d in deps for d in ("eslint", "@biomejs/biome", "oxlint")) or "lint" in scripts,
        "formatter": any(f.split("/")[-1].startswith((".prettierrc", "prettier.config.", "biome.json", "dprint.json")) for f in files)
                     or any(d in deps for d in ("prettier", "@biomejs/biome", "dprint")),
        "lint_passes": passes("lint"),
        "format_passes": passes("format:check", "check:format", "format-check", "prettier:check"),
        "readme": any(f.lower() in ("readme.md", "readme") for f in files),
        "agents_md": agents.exists() and agents.read_text(errors="replace") != ctx["agents_stub"],
    }


def duplication(work: Path, files: list[str]) -> dict:
    """jscpd over the measured files, its default thresholds (50 tokens, 5 lines)."""
    if not files:
        return {"clones": 0, "duplicated_lines": 0, "percentage": 0.0, "error": None}
    report = Path("/tmp/jscpd")
    code, out = run([str(TOOLS / "node_modules/.bin/jscpd"), "--silent", "--reporters", "json", "--output", str(report),
                     *files], work)
    try:
        total = json.loads((report / "jscpd-report.json").read_text())["statistics"]["total"]
    except (OSError, ValueError, KeyError):
        return {"clones": None, "duplicated_lines": None, "percentage": None, "error": f"jscpd exited {code}: {out[-1500:]}"}
    return {"clones": total["clones"], "duplicated_lines": total["duplicatedLines"],
            "percentage": round(total["percentage"], 2), "error": None}


def dead_code(work: Path, files: list[str]) -> dict:
    """knip's unused files and exports, kept to the measured files. knip finds the entries itself (package.json
    scripts and its plugins)."""
    code, out = run([str(TOOLS / "node_modules/.bin/knip"), "--reporter", "json", "--no-progress", "--no-exit-code",
                     "--no-config-hints"], work)
    try:
        data = json.loads(out[out.index("{"):out.rindex("}") + 1])
    except ValueError:
        return {**dict.fromkeys(["unused_files", "unused_exports", "n_unused_files", "n_unused_exports"]),
                "error": f"knip exited {code}: {out[-1500:]}"}
    keep = set(files)
    issues = data.get("issues") or []
    unused_files = sorted({*(data.get("files") or []), *(i["file"] for i in issues if i.get("files"))} & keep)
    exports = sorted(f"{i['file']}:{e['name']}" for i in issues if i.get("file") in keep
                     for kind in ("exports", "types", "nsExports", "nsTypes", "enumMembers", "classMembers")
                     for e in (i.get(kind) or []) if isinstance(e, dict) and e.get("name"))
    return {"unused_files": unused_files, "unused_exports": exports, "n_unused_files": len(unused_files),
            "n_unused_exports": len(exports), "error": None}


TEST_S = 300


def test_counts(out: str) -> tuple[int | None, int | None]:
    """Node's test runner summary, TAP (`# pass 3`) or spec (`ℹ pass 3`)."""
    found = {k: re.findall(rf"^[#ℹ]\s*{k}\s+(\d+)\s*$", out, re.M) for k in ("pass", "fail")}
    return (int(found["pass"][-1]) if found["pass"] else None, int(found["fail"][-1]) if found["fail"] else None)


def flakiness(work: Path, pkg: dict) -> dict:
    """`npm test` 3 times, no service up, each under a hard timeout."""
    if "test" not in (pkg.get("scripts") or {}):
        return {"runs": [], "passed_runs": None, "error": "no test script"}
    runs = []
    for _ in range(3):
        code, out = run(["npm", "test"], work, timeout=TEST_S)
        passed, failed = test_counts(out)
        runs.append({"exit": code, "pass": passed, "fail": failed})
    return {"runs": runs, "passed_runs": sum(r["exit"] == 0 for r in runs), "error": None}


def coverage(work: Path, pkg: dict, files: list[str], glue_files: list[str]) -> dict:
    """`npm test` line coverage (c8, every measured non-test file counted, loaded or not), split glue and domain."""
    src = [f for f in files if not is_test(f)]
    nulls = {"line_pct": None, "glue_line_pct": None, "domain_line_pct": None, "files": {}}
    if "test" not in (pkg.get("scripts") or {}):
        return {**nulls, "error": "no test script"}
    report = Path("/tmp/coverage")
    cmd = [str(TOOLS / "node_modules/.bin/c8"), "--all", "--src", str(work), "--reporter", "json-summary",
           "--report-dir", str(report), "--temp-directory", "/tmp/c8-raw", "--exclude-after-remap",
           *(a for f in src for a in ("--include", f)), "npm", "test"]
    code, out = run(cmd, work, timeout=TEST_S)
    try:
        summary = json.loads((report / "coverage-summary.json").read_text())
    except (OSError, ValueError):
        return {**nulls, "error": f"c8 exited {code}: {out[-1500:]}"}
    per = {Path(k).relative_to(work).as_posix(): v["lines"] for k, v in summary.items() if k != "total"}
    per = {f: v for f, v in per.items() if f in src}

    def pct(fs: list[str]) -> float | None:
        total = sum(per[f]["total"] for f in fs if f in per)
        return round(100 * sum(per[f]["covered"] for f in fs if f in per) / total, 1) if total else None

    return {"line_pct": pct(src), "glue_line_pct": pct(glue_files), "domain_line_pct": pct([f for f in src if f not in glue_files]),
            "files": {f: v["pct"] for f, v in sorted(per.items())}, "tests_exit": code, "error": None}


def copy_build(work: Path) -> None:
    def ignore(d: str, names: list[str]) -> set[str]:
        return {n for n in names if n in GENERATED or n.startswith("runs-")}

    shutil.copytree(APP, work, ignore=ignore, symlinks=True, dirs_exist_ok=True)


def main(ctx_path: str, out_path: str) -> None:
    ctx = json.loads(Path(ctx_path).read_text())
    pkg = json.loads((APP / "package.json").read_text()) if (APP / "package.json").exists() else {}
    deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}
    measured, excluded = scope(ctx, deps)
    work = Path("/work")
    copy_build(work)
    lines = cloc(work, measured)
    code_lines = sum(lines.get(f, {}).get("code", 0) for f in measured)
    escapes, complexity = escapes_and_complexity(work, measured, code_lines)
    glued = glue(ctx, work, measured, lines)
    installed = install(work)
    metrics = {
        "stack": ctx["stack"],
        "definitions": {
            "measured": "TypeScript and JavaScript files without the given inputs, the Next.js app and generated files",
            "modules": "folders holding measured non-test files",
            "test_files": "files under test/, tests/ or __tests__/, or named *.test.* or *.spec.*",
        },
        "measured": measured,
        "excluded": excluded,
        "size": size(measured, lines),
        "glue": glued,
        "type_escapes": escapes,
        "complexity": complexity,
        "install": installed,
        "ruleset": ruleset(ctx, work, measured, code_lines),
        "duplication": duplication(work, measured),
        "dead_code": dead_code(work, measured),
        "dependencies": dependencies(ctx, pkg),
        "tsconfig": tsconfig(ctx),
        # Code checks: deterministic, read from the code.
        "code_checks": {"hardcoded_thresholds": hardcoded_thresholds(ctx, work, measured)},
        "practices": practices(ctx, pkg, work),
        "coverage": coverage(work, pkg, measured, glued["glue_files"]),
        "flakiness": flakiness(work, pkg),
    }
    Path(out_path).write_text(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main(*sys.argv[1:])
