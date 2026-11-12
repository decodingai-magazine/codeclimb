"""Grade the topology check: the trial's probes (delivered in /app/probe by `artifacts`) and the verifier's own."""
import json
import pathlib
import re


def read(path):
    p = pathlib.Path(path)
    return p.read_text().strip() if p.exists() else "MISSING"


def probes(folder):
    return {p.stem: read(p) for p in sorted(pathlib.Path(folder).glob("*.txt"))}


def blocked(curl_output):
    # curl prints 000 as the status code and exits non-zero when it cannot connect.
    return curl_output.startswith("000exit=")


trial = probes("/app/probe")
verifier = probes("/tmp/verifier-probe")
docker_version = re.compile(r"^\d+\.\d+")

checks = {
    # the trial container
    "trial_first_docker_call": bool(docker_version.match(trial.get("first-docker-call", ""))),
    "trial_docker_run": trial.get("docker-run") == "dind-ok",
    "trial_baked_app_visible": trial.get("baked") == "baked",
    "trial_nested_reads_app": trial.get("nested-reads-app") == "baked",
    # from-nested.txt is the file the nested-writes-app probe wrote through the sidecar daemon.
    "trial_nested_writes_app": trial.get("from-nested") == "nested",
    "trial_job_mount": trial.get("job-mount") == "mounted by the job",
    "trial_github_blocked": blocked(trial.get("github", "")),
    "trial_open_web": trial.get("open-web") == "200",
    "trial_npm_ci": trial.get("npm-ci") == "installed",
    # the separate verifier container
    "artifact_delivered": read("/app/baked.txt") == "baked" and "docker-run" in trial,
    "artifact_excludes_node_modules": trial.get("npm-ci") == "installed" and verifier.get("artifact-node-modules") == "absent",
    "artifact_carries_job_mount": read("/app/mounted/note.txt") == "mounted by the job",
    "verifier_first_docker_call": bool(docker_version.match(verifier.get("first-docker-call", ""))),
    "verifier_docker_run": verifier.get("docker-run") == "dind-ok",
    "verifier_nested_reads_artifact": verifier.get("nested-reads-artifact") == "baked",
    "verifier_github_blocked": blocked(verifier.get("github", "")),
    "verifier_open_web": verifier.get("open-web") == "200",
    "verifier_npm_ci": verifier.get("npm-ci") == "installed",
}
reward = {"reward": sum(checks.values()) / len(checks), "done": int(all(checks.values()))}
reward.update({name: int(ok) for name, ok in checks.items()})
pathlib.Path("/logs/verifier/reward.json").write_text(json.dumps(reward))
# nested-github is recorded, not graded: it is the known hole, a fact about the block and not a requirement.
details = {"trial": trial, "verifier": verifier}
pathlib.Path("/logs/verifier/details.json").write_text(json.dumps(details, indent=1))
print(json.dumps(reward, indent=1))
print(json.dumps(details, indent=1))
