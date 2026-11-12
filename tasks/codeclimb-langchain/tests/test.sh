#!/bin/bash
# Grade the build that arrived in /app through `artifacts`. verifier/ is copied in by assemble.py.
mkdir -p /logs/verifier
cd /app
# The Agent Server needs the key in /app/.env, and a git checkout: artifacts carry neither.
printf 'LANGSMITH_API_KEY=%s\nLANGSMITH_TRACING=false\n' "$LANGSMITH_API_KEY" > .env
rm -rf .git && git init -q && git add -A && git commit -q -m "build under test"
python3 /tests/verifier/run.py --app /app --stack langchain --out /logs/verifier/reward.json
