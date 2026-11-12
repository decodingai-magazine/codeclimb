# 22: Relay and path to the proxy

**What to build:** A sandbox on the `cc-meter` network reaches the proxy at `http://cc-meter-relay:8080/v1`. The build keeps that path up: it ensures the network and the relay container exist, that the relay runs and forwards to the right target and port, and recreates it otherwise. "The path is up" is one call other steps make before they spend money.

**Spec sections:**
- "Metering proxy" > "Path to the proxy": every bullet but the listener
- "Known gaps": the bullet on one relay for every server (what the relay test must put back)
- "Deployment and environment": `CODECLIMB_RELAY_TARGET`, `CODECLIMB_PROXY_PORT`
- "Every number in one place": the ports row

**Not yet:** calling the check from the coder, the evaluator and the smoke test (tickets 23, 29).

**Blocked by:** 08, 21

**Status:** ready-for-agent

- [ ] The relay is a container named `cc-meter-relay` from the scenario's image, on `cc-meter`, running a TCP forwarder written with Python's standard library from port 8080 to the relay target and the proxy's port
- [ ] It is labelled `cc.meter=1`, `cc.meter.port` and `cc.meter.target`, carries no managed label, and is never swept
- [ ] The path check passes when the network and the relay exist, the relay runs, and both labels match the proxy's port and the relay target; otherwise it recreates the relay
- [ ] The relay target is `CODECLIMB_RELAY_TARGET`, or `host.docker.internal` when unset; every relay gets that host-gateway alias
- [ ] Two concurrent path checks end with one running relay; neither removes a relay the other just started
- [ ] There is no HTTP probe from the Agent Server side
- [ ] A sandbox created on `cc-meter` gets a 401 from the proxy through `http://cc-meter-relay:8080/v1` with a bad token, and a canned answer with a good one (Docker test, run where the proxy is reachable from the relay)
- [ ] The Docker test puts back the relay it found, with that relay's port and target labels, or the default target when the found relay had no target label
- [ ] `npm run typecheck` and `npm test` pass
