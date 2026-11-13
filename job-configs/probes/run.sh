#!/usr/bin/env bash
# The harness probes (#44): short Claude Code trials on the subscription, in the Inngest trial environment, with the
# task's instruction replaced by a probe template and no verifier. Each probe uses the operator's subscription.
#
#   job-configs/probes/run.sh <probe>...     # one-line | network | budget | big
#
# Reads CLAUDE_CODE_OAUTH_TOKEN from the repo's .env without printing it. Output: jobs/probe-<probe>-<time>/.
set -euo pipefail
cd "$(dirname "$0")/../.."
here=job-configs/probes

CLAUDE_CODE_OAUTH_TOKEN="$(grep '^CLAUDE_CODE_OAUTH_TOKEN=' .env | cut -d= -f2-)"
export CLAUDE_CODE_OAUTH_TOKEN CLAUDE_FORCE_OAUTH=1
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] || { echo "no CLAUDE_CODE_OAUTH_TOKEN in .env" >&2; exit 1; }

python3 assemble.py inngest > /dev/null

for probe in "$@"; do
  extra=()
  case "$probe" in
    one-line|network) template="$here/$probe.md" ;;
    budget) template="$here/budget.md"; extra=(--ak max_budget_usd=0.01) ;;
    big)
      # 120 KB of filler before the one-line instruction: Harbor hands the instruction to the container in an
      # environment variable, and Linux caps one argument or variable at 128 KiB.
      mkdir -p jobs && template=jobs/probe-big-template.md
      python3 - "$template" <<'EOF'
import sys
line = "This line is filler for a size probe; ignore it.\n"
body = line * (120 * 1024 // len(line))
open(sys.argv[1], "w").write("{% if false %}{{ instruction }}{% endif %}" + body + "Reply with the single word: ok\n")
EOF
      ;;
    *) echo "unknown probe: $probe" >&2; exit 2 ;;
  esac
  harbor run -y -p tasks/codeclimb-inngest -a claude-code -m anthropic/claude-opus-5-5 \
    --ak reasoning_effort=medium --ak prompt_template_path="$template" ${extra[@]+"${extra[@]}"} \
    --disable-verification --job-name "probe-$probe-$(date +%H%M%S)" -o jobs
done
