#!/bin/bash
# Run the topology check, $0: Harbor's oracle agent runs the probes, no harness and no model.
# The mount is passed here because it needs an absolute source path: Harbor's compose project directory is the
# task's environment/ folder, so a relative source in a job file names a folder there, which Docker creates empty
# and mounts, silently.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec harbor run -c job-configs/topology-check.yaml --mounts \
  "[{\"type\":\"bind\",\"source\":\"$PWD/tasks/topology-check/mount-fixture\",\"target\":\"/app/mounted\",\"read_only\":true}]" "$@"
