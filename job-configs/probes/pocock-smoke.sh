#!/usr/bin/env bash
# The pocock smoke trial (#50): the stack's `full-pocock` job file on the two-ticket dummy pile (pocock-pile/), one
# attempt, no retry, no verifier, a budget cap and a short agent timeout, so the harness works the two tickets and
# stops instead of going on into E2E.md. Uses the operator's subscription.
#
#   job-configs/probes/pocock-smoke.sh <stack> [cap in USD, default 3]
#
# Reads CLAUDE_CODE_OAUTH_TOKEN from the repo's .env without printing it. Output: jobs/smoke-pocock-<stack>-<time>/.
set -euo pipefail
cd "$(dirname "$0")/../.."
stack="$1"; cap="${2:-3}"

CLAUDE_CODE_OAUTH_TOKEN="$(grep '^CLAUDE_CODE_OAUTH_TOKEN=' .env | cut -d= -f2-)"
export CLAUDE_CODE_OAUTH_TOKEN CLAUDE_FORCE_OAUTH=1
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] || { echo "no CLAUDE_CODE_OAUTH_TOKEN in .env" >&2; exit 1; }

name="smoke-pocock-$stack-$(date +%H%M%S)"
mkdir -p jobs
"$(uv tool dir)/harbor/bin/python" - "job-configs/$stack-full-pocock.yaml" "jobs/$name.json" "$name" "$cap" <<'EOF'
import json, sys, yaml
src, out, name, cap = sys.argv[1:]
cfg = yaml.safe_load(open(src))
cfg.update({"job_name": name, "n_attempts": 1, "n_concurrent_trials": 1, "retry": {"max_retries": 0},
            "verifier": {"disable": True}})
agent = cfg["agents"][0]
agent["kwargs"]["max_budget_usd"] = cap
agent["override_timeout_sec"] = 1800
json.dump(cfg, open(out, "w"), indent=1)
EOF
PILE=job-configs/probes/pocock-pile exec job-configs/pocock.sh "$stack" -c "jobs/$name.json" -y -o jobs
