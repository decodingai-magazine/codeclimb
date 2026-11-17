#!/usr/bin/env bash
# The maintenance pilot (#61): one Claude Code trial per stack of each gated maintenance task, one-shot workflow,
# `basic` and `hidden` families. Uses the operator's subscription (docs/codeclimb-eval-spec.md, "Maintenance tasks").
# The two stacks run side by side; a stack's tasks run one after another.
#
#   job-configs/pilot.sh <task id>...        # e.g. c1 r3 c6 c7 r14; writes jobs/pilot-<task>-<stack>-<stamp>/
#   DRY=1 job-configs/pilot.sh <task id>...  # checks each job file with --print-config; no trial
#
# Expects CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_FORCE_OAUTH=1 and CODECLIMB_BENCH_LANGSMITH_API_KEY exported, as for any trial.
set -uo pipefail
cd "$(dirname "$0")/.."
[ $# -gt 0 ] || { echo "usage: job-configs/pilot.sh <task id>..." >&2; exit 2; }
if [ -z "${DRY:-}" ]; then
  [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && [ "${CLAUDE_FORCE_OAUTH:-}" = 1 ] && [ -n "${CODECLIMB_BENCH_LANGSMITH_API_KEY:-}" ] \
    || { echo "export CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_FORCE_OAUTH=1 and CODECLIMB_BENCH_LANGSMITH_API_KEY first" >&2; exit 2; }
  [ -z "${ANTHROPIC_API_KEY:-}" ] || { echo "unset ANTHROPIC_API_KEY: trials run on the subscription, never a provider key" >&2; exit 2; }
fi
export CODECLIMB_VERIFIER_FAMILIES=basic,hidden
mkdir -p jobs
stamp=$(date +%Y%m%d-%H%M)

# Assemble every task first, so no job re-assembles a folder another job is using.
for task in "$@"; do for stack in inngest langchain; do
  python3 assemble.py maintenance "$task" "$stack" > /dev/null || { echo "assemble $task $stack failed" >&2; exit 1; }
done; done

run_stack() {
  local stack=$1; shift
  for task in "$@"; do
    local name="pilot-$task-$stack-$stamp"
    sed -e "s/^job_name: .*/job_name: $name/" -e "s/^n_attempts: .*/n_attempts: 1/" \
      -e "s|tasks: \[{ path: tasks/codeclimb-$stack }\]|tasks: [{ path: tasks/codeclimb-$stack-$task }]|" \
      "job-configs/$stack-bare.yaml" > "jobs/$name.yaml"
    if [ -n "${DRY:-}" ]; then
      harbor run -c "jobs/$name.yaml" --print-config > /dev/null && echo "ok $name" || echo "BAD $name"
    else
      harbor run -c "jobs/$name.yaml" -y -o jobs > "jobs/$name.log" 2>&1; echo "$name exit $?"
    fi
  done
}
run_stack inngest "$@" & run_stack langchain "$@" & wait
