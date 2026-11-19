#!/usr/bin/env bash
# Run every cell from scratch: the 8 one-shot jobs (2 stacks x bare, skills, mcp-docs, full) and the 2 full x pocock
# jobs, 3 attempts each, 30 trials. At most <slots> jobs run at once, one trial each (default 3). The pocock jobs start
# first: they are the longest (3 x about 95 min), so starting them last would leave slots idle at the end. The one-shot
# jobs follow in shuffled order, one minute apart. Uses the operator's subscription (docs/codeclimb-eval-spec.md,
# "Jobs, repeats, cost"). Once every job has ended, code_metrics.py measures each build trial against its stack's pin.
#
#   job-configs/run-all.sh [slots]          # runs; writes jobs/all-<stamp>-<job file>/
#   DRY=1 job-configs/run-all.sh [slots]    # prints the order and checks each job file with --print-config; no trial
#
# Expects CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_FORCE_OAUTH=1 and CODECLIMB_BENCH_LANGSMITH_API_KEY exported, as for any trial.
# The verifier's real.* family also needs the operator's Pi Copilot login, or it is skipped and reports no keys:
#   export CODECLIMB_BENCH_PI_AUTH="$(python3 job-configs/pi-auth.py)"
# CODECLIMB_VERIFIER_FAMILIES without `real` (e.g. basic,hidden) runs without it.
set -uo pipefail
cd "$(dirname "$0")/.."
slots=${1:-3}
stamp=$(date +%Y%m%d-%H%M)
logs=jobs/all-$stamp-logs

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
fi

# Assemble once, before any job starts: pocock.sh would re-assemble a stack's task while that stack's other jobs run.
python3 assemble.py inngest > /dev/null && python3 assemble.py langchain > /dev/null || exit 1

oneshot=$(printf '%s\n' {inngest,langchain}-{bare,skills,mcp-docs,full} \
  | python3 -c 'import random,sys;l=sys.stdin.read().split();random.shuffle(l);print(" ".join(l))')
queue="$(printf '%s\n' inngest-full-pocock langchain-full-pocock | python3 -c 'import random,sys;l=sys.stdin.read().split();random.shuffle(l);print(" ".join(l))') $oneshot"
echo "slots: $slots; order: $queue"

run() {  # $1 job file name; the pocock overlay needs the stack's absolute pocock dir
  local f=$1 stack=${1%%-*}
  CODECLIMB_POCOCK_DIR="$PWD/tasks/codeclimb-$stack/pocock" harbor run -c "job-configs/$f.yaml" "${@:2}"
}

if [ -n "${DRY:-}" ]; then
  for f in $queue; do run "$f" --print-config > /dev/null && echo "ok $f" || { echo "bad $f" >&2; exit 1; }; done
  exit 0
fi

mkdir -p "$logs"
pids=()
for f in $queue; do
  while :; do  # wait for a free slot
    live=(); for p in "${pids[@]}"; do kill -0 "$p" 2>/dev/null && live+=("$p"); done; pids=("${live[@]}")
    [ "${#pids[@]}" -lt "$slots" ] && break
    sleep 30
  done
  echo "$(date +%H:%M) start $f"
  run "$f" --job-name "all-$stamp-$f" -o jobs -y > "$logs/$f.log" 2>&1 &
  pids+=($!)
  sleep 60
done
wait
# The code and practice metrics of every build trial, against its stack's pin ($0, the analysis container).
echo "$(date +%H:%M) code metrics"
python3 code_metrics.py jobs jobs/all-$stamp-*-* > "$logs/code-metrics.log" 2>&1 || echo "code metrics: some trials failed, see $logs/code-metrics.log" >&2
echo "$(date +%H:%M) all done; analyze with: uv run python analyze.py jobs/all-$stamp-*-* "
