#!/usr/bin/env bash
# Grade a maintenance task's /app as given, with the `nop` agent: the floor of a maintenance trial, $0. Its leak
# must be 0 and its target tests must fail (docs/codeclimb-eval-spec.md, "Maintenance tasks").
#
#   job-configs/maintenance.sh <task id> <stack> [harbor run args...]
#
# Assembles tasks/codeclimb-<stack>-<task id>/ first. LangChain expects CODECLIMB_BENCH_LANGSMITH_API_KEY (and
# CODECLIMB_BENCH_LANGSMITH_ENDPOINT) exported, as for any LangChain trial.
set -euo pipefail
cd "$(dirname "$0")/.."
task="$1"; stack="$2"; shift 2
python3 assemble.py maintenance "$task" "$stack" > /dev/null

name="maintenance-$task-$stack-nop-$(date +%H%M%S)"
mkdir -p jobs
cat > "jobs/$name.yaml" <<EOF
job_name: $name
n_attempts: 1
n_concurrent_trials: 1
tasks: [{ path: tasks/codeclimb-$stack-$task }]
environment:
  type: docker
  extra_docker_compose: [$PWD/job-configs/maintenance.compose.yaml]
agents:
  - name: nop
EOF
exec harbor run -c "jobs/$name.yaml" -y -o jobs "$@"
