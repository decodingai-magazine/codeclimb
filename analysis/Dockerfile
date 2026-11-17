# The code and practice analysis step's own container (docs/codeclimb-eval-spec.md, Metrics): every tool at an exact
# version, outside any build. code_metrics.py mounts a build read-only at /app and runs measure.py here.
FROM node:24.22.3-trixie@sha256:6e5d4c38403930b420404f190be8563396dca2bd156a6cb4722707b0efcf6fc1

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 cloc=2.04-1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /tools
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY eslint.measure.mjs eslint.ruleset.mjs measure.py ./
