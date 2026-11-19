"""Stops a run on the first subscription usage-limit stop (docs/codeclimb-eval-spec.md, "Jobs, repeats, cost").

    python3 usage_watch.py <marker file> <job dir glob> <job name regex>

Every 30 s it reads the stream (`agent/claude-code.txt`) of every trial under the job dirs the glob matches. The
stream reaches the host when the agent phase ends (Harbor copies the agent logs before the verifier starts), and a
usage-limit stop ends the agent phase, so the watch sees it right after the stop. On the first usage-limit
stop (analyze.stream_facts' rule) it writes the marker, one trial dir per line, and sends SIGTERM to every
`harbor run` whose command line matches the job name regex. Harbor handles SIGTERM as a cancel: each running trial
syncs its agent logs and collects its artifacts (`/app`, the sessions) before its environment stops, so its state is
kept for a rerun by hand. The runners (run-all.sh, pilot.sh) start no job once the marker exists.
"""

import subprocess
import sys
import time
from pathlib import Path

from analyze import stream_facts

POLL_S = 30


def usage_limited(jobs: str) -> list[Path]:
    """The trials under the job dirs the glob `jobs` matches whose stream shows a usage-limit stop."""
    base = Path(jobs)
    streams = sorted(base.parent.glob(f"{base.name}/*/agent/claude-code.txt"))
    return [s.parent.parent for s in streams if stream_facts(s)["usage_limit"]]


def main(marker: Path, jobs: str, name: str) -> None:
    while not (hit := usage_limited(jobs)):
        time.sleep(POLL_S)
    marker.write_text("".join(f"{t}\n" for t in hit))
    print(f"usage limit in {', '.join(map(str, hit))}: stopping every harbor run of {name}", file=sys.stderr)
    subprocess.run(["pkill", "-TERM", "-f", f"harbor run .*{name}"])


if __name__ == "__main__":
    main(Path(sys.argv[1]), sys.argv[2], sys.argv[3])
