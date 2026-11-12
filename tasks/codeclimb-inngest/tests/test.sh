#!/bin/bash
# Grade the build that arrived in /app through `artifacts`. verifier/ is copied in by assemble.py.
mkdir -p /logs/verifier
python3 /tests/verifier/run.py --app /app --stack inngest --out /logs/verifier/reward.json
