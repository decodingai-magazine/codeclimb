#!/usr/bin/env bash
# Starts the full run with the OAuth token from the repo's .env. Prints no secret.
set -uo pipefail
cd "$(dirname "$0")"
unset ANTHROPIC_API_KEY
CLAUDE_CODE_OAUTH_TOKEN="$(grep -E '^CLAUDE_CODE_OAUTH_TOKEN=' .env | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
export CLAUDE_CODE_OAUTH_TOKEN CLAUDE_FORCE_OAUTH=1
export CODECLIMB_BENCH_PI_AUTH="$(python3 job-configs/pi-auth.py)"
[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] || { echo "no token in .env"; exit 2; }
DRY=1 job-configs/run-all.sh 3 | tail -3 || exit 1
caffeinate -i job-configs/run-all.sh 3 2>&1 | tee jobs/run-all.out
