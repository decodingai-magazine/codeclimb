# The trial container shares the Docker sidecar's network namespace

Each trial gets its own Docker daemon, a `docker:27-dind` sidecar, so sandbox names like `cc-meter` never clash between trials. With the trial container in its own network namespace neither reference build could run its mock nights (measured 2026-11-12): the Inngest metering relay's host-gateway alias pointed at the sidecar, where no proxy listened, and the LangChain server came up on the sidecar's `127.0.0.1:8123` with an empty `/app`. So the trial container runs with `network_mode: "service:dind"`, and `/app` and `/root/.pi` are named volumes mounted at the same paths in both containers. The verifier environment uses the same topology.

## Considered options

- **The host's Docker socket.** Rejected: `cc-meter` and `cc-meter-relay` are global names, the relay would forward to the host instead of the trial, and a trial's `docker ps` checks would see other trials. It stays the fallback, with one trial at a time.
- **A sidecar daemon with separate network namespaces**, as first designed. Rejected: it fails on both stacks, as measured above.

## Consequences

- `extra_hosts` cannot be set on the trial container beside the shared network mode, so the GitHub block sits on the sidecar service, whose `/etc/hosts` the trial container shares.
- Containers started on the sidecar daemon have their own `/etc/hosts`, so they still reach GitHub. The trajectory scan, not the network, decides `leak`.
- On Inngest the environment presets `CODECLIMB_PROXY_HOST` to the sidecar's bridge address, in the trial and in the verifier.
