# The trial container of the topology check: Node 24, curl and the Docker CLI. /app is baked in, then shadowed by a
# named volume shared with the Docker sidecar (environment/docker-compose.yaml).
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY app/ /app/
