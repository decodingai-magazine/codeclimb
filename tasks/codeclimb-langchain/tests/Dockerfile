# The verifier container of the LangChain task: the trial image's tools without the harness; /app arrives as the
# trial's artifact, onto a named volume the verifier's own sidecar shares.
FROM node:24-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 git curl ca-certificates procps \
  && rm -rf /var/lib/apt/lists/* \
  && git config --system user.name codeclimb \
  && git config --system user.email codeclimb@localhost \
  && git config --system init.defaultBranch main \
  && git config --system --add safe.directory '*'
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /uvx /usr/local/bin/
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:27-cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins

WORKDIR /app
# Harbor bundles the tests: a tests/Dockerfile means the image itself must hold /tests.
COPY . /tests/
