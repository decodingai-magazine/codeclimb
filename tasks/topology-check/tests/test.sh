#!/bin/bash
# The verifier side of the topology check: its own probes, then check.py grades them with the trial's.
mkdir -p /logs/verifier /tmp/verifier-probe
probe() { name=$1; shift; { "$@" 2>&1 || echo "exit=$?"; } | tail -c 400 > "/tmp/verifier-probe/$name.txt"; }

# Before anything installs here: the trial ran `npm ci`, and `artifacts` must have left node_modules behind.
probe artifact-node-modules sh -c 'test -e /app/node_modules && echo present || echo absent'
probe first-docker-call docker info --format '{{.ServerVersion}}'
probe docker-run docker run --quiet --rm alpine:3.21 echo dind-ok
# The artifact landed on the verifier's own /app volume, which its sidecar mounts at the same path.
probe nested-reads-artifact docker run --rm -v /app:/shared alpine:3.21 cat /shared/baked.txt
probe github sh -c 'curl -s -m 8 -o /dev/null -w "%{http_code}" https://github.com'
# The block must not cost the verifier the open web or an install: it runs `npm ci` on every build it grades.
probe open-web sh -c 'curl -s -m 15 -o /dev/null -w "%{http_code}" https://www.inngest.com/llms.txt'
probe npm-ci sh -c 'cd /app && npm ci --ignore-scripts >/dev/null 2>&1 && test -d node_modules/is-number && echo installed'
python3 /tests/check.py
