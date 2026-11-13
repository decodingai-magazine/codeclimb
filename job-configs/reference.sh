#!/usr/bin/env bash
# Grade a stack's reference build inside Harbor's separate verifier environment: the `nop` agent on a trial whose
# /app holds the build (job-configs/reference.compose.yaml), then the task's own verifier. $0: no harness runs.
#
#   job-configs/reference.sh <stack> [commit] [harbor run args...]
#
# The commit defaults to the stack's pin in docs/codeclimb-eval-spec.md ("Reference builds"). It is exported with
# `git archive` to jobs/reference-<stack>-<commit>/ (gitignored). LangChain expects CODECLIMB_BENCH_LANGSMITH_API_KEY
# (and CODECLIMB_BENCH_LANGSMITH_ENDPOINT) exported, as for any LangChain trial.
set -euo pipefail
cd "$(dirname "$0")/.."
stack="$1"; shift
case "$stack" in
  inngest) pin=4a71177 ;;
  langchain) pin=2ab1ad3 ;;
  *) echo "stack: inngest | langchain" >&2; exit 2 ;;
esac
commit="${1:-$pin}"; [ $# -gt 0 ] && shift
commit=$(git rev-parse --short=7 "$commit^{commit}")

build="$PWD/jobs/reference-$stack-$commit"
rm -rf "$build" && mkdir -p "$build"
git archive "$commit" | tar -x -C "$build"
python3 assemble.py "$stack" > /dev/null

name="reference-$stack-$commit-$(date +%H%M%S)"
cat > "jobs/$name.yaml" <<EOF
job_name: $name
n_attempts: 1
n_concurrent_trials: 1
tasks: [{ path: tasks/codeclimb-$stack }]
environment:
  type: docker
  extra_docker_compose: [$PWD/job-configs/reference.compose.yaml]
agents:
  - name: nop
EOF
export CODECLIMB_REFERENCE_DIR="$build"
exec harbor run -c "jobs/$name.yaml" -y -o jobs "$@"
