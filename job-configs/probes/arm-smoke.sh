#!/usr/bin/env bash
# The arm smoke trials (#48): one short trial per arm job file, with the build replaced by the arm-smoke probe
# (start the dev server, try the inngest-dev MCP) and no verifier. Uses the operator's subscription.
#
#   job-configs/probes/arm-smoke.sh <stack> <arm>...     # inngest bare skills mcp-docs full
#
# Reads CLAUDE_CODE_OAUTH_TOKEN from the repo's .env without printing it. Output: jobs/smoke-<stack>-<arm>-<time>/.
set -euo pipefail
cd "$(dirname "$0")/../.."
stack="$1"; shift

CLAUDE_CODE_OAUTH_TOKEN="$(grep '^CLAUDE_CODE_OAUTH_TOKEN=' .env | cut -d= -f2-)"
export CLAUDE_CODE_OAUTH_TOKEN CLAUDE_FORCE_OAUTH=1
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] || { echo "no CLAUDE_CODE_OAUTH_TOKEN in .env" >&2; exit 1; }

python3 assemble.py "$stack" > /dev/null
mkdir -p jobs
for arm in "$@"; do
  name="smoke-$stack-$arm-$(date +%H%M%S)"
  # The arm's job file, cut to one attempt, no retry and no verifier, with the probe as the prompt template.
  python3 - "job-configs/$stack-$arm.yaml" "jobs/$name.json" "$name" <<'EOF'
import json, re, sys
src, out, name = sys.argv[1:]
text = open(src).read()
cfg = {"job_name": name, "n_attempts": 1, "n_concurrent_trials": 1, "retry": {"max_retries": 0},
       "verifier": {"disable": True}, "tasks": [{"path": re.search(r"path: (\S+) \}", text).group(1)}],
       "environment": {"type": "docker"}}
agent = {"name": "claude-code", "model_name": "anthropic/claude-opus-5-5",
         "kwargs": {"reasoning_effort": "medium", "prompt_template_path": "job-configs/probes/arm-smoke.md"}}
skills = re.findall(r"^      - (context/\S+)$", text, re.MULTILINE)
if skills:
    agent["skills"] = skills
m = re.search(r"- name: (\S+)\n\s+transport: (\S+)\n\s+url: (\S+)", text)
if m:
    agent["mcp_servers"] = [{"name": m.group(1), "transport": m.group(2), "url": m.group(3)}]
paths = re.search(r"^extra_instruction_paths: \[(.*)\]$", text, re.MULTILINE)
if paths:
    cfg["extra_instruction_paths"] = [p.strip() for p in paths.group(1).split(",")]
cfg["agents"] = [agent]
json.dump(cfg, open(out, "w"), indent=1)
EOF
  harbor run -y -c "jobs/$name.json" -o jobs
done
