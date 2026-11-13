#!/usr/bin/env bash
# Run a stack's `full × pocock` job: assembles the task with its pocock files and points the job's compose overlay
# (job-configs/pocock.compose.yaml) at them with an absolute path. Uses the operator's subscription.
#
#   job-configs/pocock.sh <stack> [harbor run args...]          # the stack's pile
#   PILE=<dir> job-configs/pocock.sh <stack> -c <job file> ...  # another pile, another job file (the smoke trial)
#
# Expects CLAUDE_CODE_OAUTH_TOKEN and CLAUDE_FORCE_OAUTH=1 exported (and, on LangChain,
# CODECLIMB_BENCH_LANGSMITH_API_KEY), as for any trial.
set -euo pipefail
cd "$(dirname "$0")/.."
stack="$1"; shift
if [ -n "${PILE:-}" ]; then
  python3 assemble.py "$stack" --pile "$PILE" > /dev/null
else
  python3 assemble.py "$stack" > /dev/null
fi
export CODECLIMB_POCOCK_DIR="$PWD/tasks/codeclimb-$stack/pocock"
if [ "${1:-}" = "-c" ]; then exec harbor run "$@"; fi
exec harbor run -c "job-configs/$stack-full-pocock.yaml" "$@"
