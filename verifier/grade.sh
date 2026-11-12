#!/bin/bash
# Grade a build from the host, $0: the verifier image and topology of tasks/codeclimb-<stack>/tests, outside Harbor.
#   verifier/grade.sh <build dir> <stack> [<out dir>]
# The build is copied into the verifier's /app volume, so the run gets its own Docker daemon and never touches the
# host's containers (cc-meter, the Agent Server on 8123). Writes <out dir>/reward.json and checks.json.
# LangChain needs CODECLIMB_BENCH_LANGSMITH_API_KEY in the environment.
set -euo pipefail
src=$(cd "$1" && pwd)
stack=$2
root=$(cd "$(dirname "$0")/.." && pwd)
out=${3:-$root/jobs/grade-$stack-$(date +%Y%m%d-%H%M%S)}; mkdir -p "$out"; out=$(cd "$out" && pwd)
tests=$root/tasks/codeclimb-$stack/tests
test -d "$tests/verifier" || { echo "run: python3 assemble.py $stack" >&2; exit 2; }

project=grade-$stack-$$
override=$(mktemp -t grade-override.XXXXXX)
trap 'docker compose -p "$project" -f "$tests/docker-compose.yaml" -f "$override" down -v --remove-orphans >/dev/null 2>&1; rm -f "$override"' EXIT
cat > "$override" <<EOF
services:
  main:
    build: { context: "$tests" }
    volumes:
      - "$src:/src:ro"
      - "$out:/logs/verifier"
    command: ["sh", "-c", "cp -a /src/. /app/ && /tests/test.sh"]
EOF
docker compose -p "$project" -f "$tests/docker-compose.yaml" -f "$override" run --build --rm main
echo "reward: $out/reward.json"
