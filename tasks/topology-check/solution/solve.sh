#!/bin/bash
# The trial side of the topology check, run by Harbor's oracle agent in the trial container. Each probe writes what it saw to /app/probe/<name>.txt; tests/check.py grades
# the files once they reach the verifier through `artifacts`.
mkdir -p /app/probe
probe() { name=$1; shift; { "$@" 2>&1 || echo "exit=$?"; } | tail -c 400 > "/app/probe/$name.txt"; }

# No retry loop on purpose: the sidecar's healthcheck gates `main`, so the first Docker call must find the daemon ready.
probe first-docker-call docker info --format '{{.ServerVersion}}'
probe docker-run docker run --quiet --rm alpine:3.21 echo dind-ok
probe baked cat /app/baked.txt
# /app is one volume at one path in `main` and in the sidecar, so a bind mount handed to the daemon names these files.
probe nested-reads-app docker run --rm -v /app:/shared alpine:3.21 cat /shared/baked.txt
probe nested-writes-app docker run --rm -v /app:/shared alpine:3.21 sh -c 'echo nested > /shared/probe/from-nested.txt && echo wrote'
probe job-mount cat /app/mounted/note.txt
probe github sh -c 'curl -s -m 8 -o /dev/null -w "%{http_code}" https://github.com'
probe open-web sh -c 'curl -sS -m 15 -o /dev/null -w "%{http_code}" https://www.inngest.com/llms.txt'
probe npm-ci sh -c 'cd /app && npm ci --ignore-scripts >/dev/null 2>&1 && test -d node_modules/is-number && echo installed'
# Recorded, not graded: the known hole. A container on the sidecar daemon has its own /etc/hosts.
probe nested-github docker run --rm alpine:3.21 sh -c 'wget -q -T 8 -O /dev/null https://github.com && echo reached || echo blocked'
