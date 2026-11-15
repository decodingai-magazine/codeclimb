#!/bin/bash
# Grade the build that arrived in /app through `artifacts`. verifier/ is copied in by assemble.py.
mkdir -p /logs/verifier
# The real.* family: Pi reads the Copilot login from its default auth.json. Never echoed.
if [ -n "${CODECLIMB_BENCH_PI_AUTH:-}" ]; then
  mkdir -p /root/.pi/agent && (umask 077 && printf '%s' "$CODECLIMB_BENCH_PI_AUTH" > /root/.pi/agent/auth.json)
fi
python3 /tests/verifier/run.py --app /app --stack inngest --out /logs/verifier/reward.json
