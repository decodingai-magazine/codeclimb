#!/usr/bin/env bash
# The arm smoke trials (#48, #49): one short trial per arm job file, with the build replaced by the stack's arm-smoke
# probe (arm-smoke-<stack>.md: check each MCP server with one read-only call) and no verifier. Uses the operator's
# subscription.
#
#   job-configs/probes/arm-smoke.sh <stack> <arm>...     # bare skills mcp-docs full
#
# Reads CLAUDE_CODE_OAUTH_TOKEN from the repo's .env without printing it. LangChain also needs
# CODECLIMB_BENCH_LANGSMITH_API_KEY (and _ENDPOINT) exported. Output: jobs/smoke-<stack>-<arm>-<time>/.
set -euo pipefail
cd "$(dirname "$0")/../.."
stack="$1"; shift

CLAUDE_CODE_OAUTH_TOKEN="$(grep '^CLAUDE_CODE_OAUTH_TOKEN=' .env | cut -d= -f2-)"
export CLAUDE_CODE_OAUTH_TOKEN CLAUDE_FORCE_OAUTH=1
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] || { echo "no CLAUDE_CODE_OAUTH_TOKEN in .env" >&2; exit 1; }
[ "$stack" != langchain ] || [ -n "${CODECLIMB_BENCH_LANGSMITH_API_KEY:-}" ] \
  || { echo "export CODECLIMB_BENCH_LANGSMITH_API_KEY first" >&2; exit 1; }

# Harbor's own Python, which has PyYAML.
python="$(uv tool dir)/harbor/bin/python"
python3 assemble.py "$stack" > /dev/null
mkdir -p jobs
for arm in "$@"; do
  name="smoke-$stack-$arm-$(date +%H%M%S)"
  # The arm's job file, cut to one attempt, no retry and no verifier, with the probe as the prompt template.
  "$python" - "job-configs/$stack-$arm.yaml" "jobs/$name.json" "$name" "job-configs/probes/arm-smoke-$stack.md" <<'EOF'
import json, sys, yaml
src, out, name, probe = sys.argv[1:]
cfg = yaml.safe_load(open(src))
cfg.update({"job_name": name, "n_attempts": 1, "n_concurrent_trials": 1, "retry": {"max_retries": 0},
            "verifier": {"disable": True}})
cfg["agents"][0]["kwargs"]["prompt_template_path"] = probe
json.dump(cfg, open(out, "w"), indent=1)
EOF
  harbor run -y -c "jobs/$name.json" -o jobs
done
