#!/usr/bin/env bash
# The full run, the whole benchmark from scratch (docs/codeclimb-eval-spec.md, "Jobs, repeats, cost"):
#   1. reference grades, $0: each stack's build-task pin and every maintenance base the counted tasks use, graded by
#      the current verifier (`job-configs/reference.sh`, side by side, <slots> at a time). Maintenance `resolved` is
#      read against the bases' grades, and a harness is never graded on a check its pin fails: a grade without a
#      reward, or a pin below reward 1, stops the run before any trial (CODECLIMB_IGNORE_REFERENCES=1 overrides).
#   2. trials, on the operator's subscription: the 10 build jobs (2 stacks x bare, skills, mcp-docs, full, and
#      full x pocock) and the 20 maintenance jobs (2 stacks x the counted tasks, maintenance.COUNTED, the `bare` arm,
#      one-shot), 3 attempts each, 90 trials. At most <slots> jobs run at once, one trial each (default 3). The pocock
#      jobs start first: they are the longest (3 x about 95 min). Then, in shuffled order one minute apart, each
#      one-shot build job, and each maintenance task's two stacks back to back in the queue, so a pair starts close in
#      time (side by side when two slots are free, otherwise about one job apart).
#   3. regrades, $0: every trial that did not pass, once (regrade.py: a build trial not done = 1, a maintenance trial not
#      resolved); then the code and practice metrics of every build trial against its stack's pin (code_metrics.py).
#
#   job-configs/run-all.sh [slots]          # runs; writes jobs/all-<stamp>-*/
#   DRY=1 job-configs/run-all.sh [slots]    # assembles, prints the order and checks each job with --print-config
#
# Expects CLAUDE_CODE_OAUTH_TOKEN and CLAUDE_FORCE_OAUTH=1 exported, as for any trial; the LangSmith key comes from .env
# (job-configs/bench-env.sh) unless CODECLIMB_BENCH_LANGSMITH_API_KEY is exported.
# The verifier's real.* family (build trials and the pins' grades) also needs the operator's Pi Copilot login, or it is
# skipped and reports no keys:
#   export CODECLIMB_BENCH_PI_AUTH="$(python3 job-configs/pi-auth.py)"
# CODECLIMB_VERIFIER_FAMILIES without `real` (e.g. basic,hidden) runs without it. Maintenance trials, their regrades and
# their bases' grades always run maintenance.FAMILIES.
set -uo pipefail
cd "$(dirname "$0")/.."
. job-configs/bench-env.sh  # the LangSmith key from .env when not exported
slots=${1:-3}
stamp=$(date +%Y%m%d-%H%M)
logs=jobs/all-$stamp-logs
refs=jobs/all-$stamp-references

if [ -z "${DRY:-}" ]; then
  [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && [ "${CLAUDE_FORCE_OAUTH:-}" = 1 ] && [ -n "${CODECLIMB_BENCH_LANGSMITH_API_KEY:-}" ] \
    || { echo "export CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_FORCE_OAUTH=1 and CODECLIMB_BENCH_LANGSMITH_API_KEY first" >&2; exit 2; }
  [ -z "${ANTHROPIC_API_KEY:-}" ] || { echo "unset ANTHROPIC_API_KEY: trials run on the subscription, never a provider key" >&2; exit 2; }
  case ",${CODECLIMB_VERIFIER_FAMILIES:-basic,hidden,real}," in
    *,real,*) case "${CODECLIMB_BENCH_PI_AUTH:-}" in
        *'"github-copilot"'*'"refresh"'*) ;;
        *) echo 'export CODECLIMB_BENCH_PI_AUTH="$(python3 job-configs/pi-auth.py)" first, or set CODECLIMB_VERIFIER_FAMILIES without real' >&2; exit 2 ;;
      esac ;;
  esac
  mkdir -p "$logs"
else
  logs=$(mktemp -d)  # the generated maintenance job files only
fi

mfam=$(python3 -c 'import maintenance; print(maintenance.FAMILIES)')
counted=$(python3 -c 'import maintenance; print(" ".join(maintenance.COUNTED))')
# Assemble once, before any job starts: no job or reference grade re-assembles a folder another one is using.
python3 assemble.py inngest > /dev/null && python3 assemble.py langchain > /dev/null || exit 1
for t in $counted; do for s in inngest langchain; do
  python3 assemble.py maintenance "$t" "$s" > /dev/null || { echo "assemble $t $s failed" >&2; exit 1; }
done; done
export CODECLIMB_ASSEMBLED=1  # reference.sh: tasks assembled above

shuffle() { python3 -c 'import random,sys;l=sys.stdin.read().split();random.shuffle(l);print(" ".join(l))'; }
queue=$(printf '%s\n' inngest-full-pocock langchain-full-pocock | shuffle)
for u in $( { printf '%s\n' {inngest,langchain}-{bare,skills,mcp-docs,full}; printf 'm:%s\n' $counted; } | shuffle); do
  case $u in
    m:*) queue="$queue $(printf '%s\n' "inngest-${u#m:}" "langchain-${u#m:}" | shuffle)" ;;
    *) queue="$queue $u" ;;
  esac
done
echo "slots: $slots; order: $queue"

run() {  # $1 a build job file name, or <stack>-<task id>: that maintenance task on the stack's `bare` job file
  local f=$1 stack=${1%%-*}
  if [ -e "job-configs/$f.yaml" ]; then  # the pocock overlay needs the stack's absolute pocock dir
    CODECLIMB_POCOCK_DIR="$PWD/tasks/codeclimb-$stack/pocock" harbor run -c "job-configs/$f.yaml" "${@:2}"
    return
  fi
  sed "s|tasks: \[{ path: tasks/codeclimb-$stack }\]|tasks: [{ path: tasks/codeclimb-$f }]|" \
    "job-configs/$stack-bare.yaml" > "$logs/$f.yaml"
  grep -q "path: tasks/codeclimb-$f }" "$logs/$f.yaml" || { echo "no task path in $stack-bare.yaml" >&2; return 1; }
  CODECLIMB_VERIFIER_FAMILIES=$mfam harbor run -c "$logs/$f.yaml" "${@:2}"
}

if [ -n "${DRY:-}" ]; then
  for f in $queue; do run "$f" --print-config > /dev/null && echo "ok $f" || { echo "bad $f" >&2; exit 1; }; done
  rm -rf "$logs"
  exit 0
fi

pids=()
reap() { live=(); for p in "${pids[@]}"; do kill -0 "$p" 2>/dev/null && live+=("$p"); done; pids=("${live[@]}"); }
slot() { while reap; [ "${#pids[@]}" -ge "$slots" ]; do sleep 30; done; }  # wait for a free slot

# 1. Reference grades: each pin with the run's families, each maintenance base with the maintenance families.
grades="$(python3 -c 'import assemble; print(" ".join(f"{s}:{c}:" for s, c in assemble.BUILD_PINS.items()))')"
grades="$grades $(python3 -c 'import maintenance as m; print(" ".join(sorted({f"{s}:{m.MAINTENANCE[k].bases[s]}:'"$mfam"'" for k in m.COUNTED for s in m.MAINTENANCE[k].bases})))')"
echo "$(date +%H:%M) reference grades: $grades"
for g in $grades; do
  IFS=: read -r stack commit fam <<< "$g"
  slot
  ( [ -z "$fam" ] || export CODECLIMB_VERIFIER_FAMILIES=$fam
    CODECLIMB_JOBS_DIR=$refs job-configs/reference.sh "$stack" "$commit" > "$logs/reference-$stack-$commit.log" 2>&1 ) &
  pids+=($!)
  sleep 5
done
[ "${#pids[@]}" -eq 0 ] || wait "${pids[@]}"
pids=()
# Every grade must have a reward, and each pin reward 1 (every basic check), or no trial starts: a harness is never
# graded on a check its pin fails. Failed hidden and real tests are printed only (the LangChain verifier's flakes; every
# maintenance base fails 10 and 59 by design). CODECLIMB_IGNORE_REFERENCES=1 starts the trials anyway.
python3 - "$refs" $grades <<'EOF_REFS' || [ -n "${CODECLIMB_IGNORE_REFERENCES:-}" ] || { echo "reference grades failed: no trial started; see $logs" >&2; exit 1; }
import glob, json, sys
from assemble import BUILD_PINS
bad = 0
for g in sys.argv[2:]:
    stack, commit, _ = g.split(":")
    found = glob.glob(f"{sys.argv[1]}/reference-{stack}-{commit}-*/*/result.json")
    w = ((json.load(open(found[0])).get("verifier_result") or {}).get("rewards") or {}) if found else {}
    failed = " ".join(k for k, v in sorted(w.items()) if k.startswith(("checks.", "hidden.", "real.")) and v != 1)
    ok = w.get("reward") is not None and (commit != BUILD_PINS[stack] or w["reward"] == 1)
    bad += not ok
    print(f"{'ok ' if ok else 'BAD'} {stack} {commit} reward {w.get('reward')} failed: {failed or 'none'}")
sys.exit(1 if bad else 0)
EOF_REFS

# 2. Trials. The usage-limit watch: on the first usage-limit stop in any trial it writes the marker and sends SIGTERM to
# every harbor run of this run, which keeps each running trial's /app and sessions (usage_watch.py). No job starts after.
marker=$logs/usage-limit
python3 usage_watch.py "$marker" "jobs/all-$stamp-*" "all-$stamp-" 2> "$logs/usage-watch.log" &
watch=$!
trap 'kill "$watch" 2>/dev/null' EXIT
for f in $queue; do
  while reap; [ ! -e "$marker" ] && [ "${#pids[@]}" -ge "$slots" ]; do sleep 30; done
  [ -e "$marker" ] && { echo "$(date +%H:%M) usage limit: not started $f"; continue; }
  echo "$(date +%H:%M) start $f"
  run "$f" --job-name "all-$stamp-$f" -o jobs -y > "$logs/$f.log" 2>&1 &
  pids+=($!)
  sleep 60
done
[ "${#pids[@]}" -eq 0 ] || wait "${pids[@]}"
if [ -e "$marker" ]; then
  echo "$(date +%H:%M) stopped on a usage limit in: $(tr '\n' ' ' < "$marker")" >&2
  echo "rerun by hand after the limit resets: the jobs not started above, and the attempts the stopped jobs did not finish" >&2
fi

# 3. The regrade rule: every trial that did not pass is regraded once, on both stacks, and the regrade counts ($0, the
# recorded artifacts; regrade.py). The reference grades are passed for the maintenance bases. Then the code metrics.
echo "$(date +%H:%M) regrades"
python3 regrade.py "jobs/all-$stamp-regrades" --slots "$slots" jobs/all-$stamp-*-* "$refs" > "$logs/regrades.log" 2>&1 || echo "regrades: some failed, see $logs/regrades.log" >&2
echo "$(date +%H:%M) code metrics"
python3 code_metrics.py jobs jobs/all-$stamp-*-* > "$logs/code-metrics.log" 2>&1 || echo "code metrics: some trials failed, see $logs/code-metrics.log" >&2
echo "$(date +%H:%M) all done; analyze with: uv run python analyze.py jobs/all-$stamp-*-* $refs jobs/all-$stamp-regrades"
