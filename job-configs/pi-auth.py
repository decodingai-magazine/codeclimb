"""Print the operator's Pi Copilot login for the verifier's real.* family, as CODECLIMB_BENCH_PI_AUTH expects it:
an auth.json holding only the `github-copilot` entry. Capture it, never display it:

    export CODECLIMB_BENCH_PI_AUTH="$(python3 job-configs/pi-auth.py)"
"""

import json
import os
import sys

path = os.environ.get("CODECLIMB_PI_AUTH_PATH") or os.path.expanduser("~/.pi/agent/auth.json")
entry = json.load(open(path)).get("github-copilot")
if not entry:
    sys.exit(f"{path}: no github-copilot login; run `npx pi`, then `/login github-copilot`")
print(json.dumps({"github-copilot": entry}))
