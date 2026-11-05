# codeclimb-python: the sandbox runtime for stdlib-only Python scenarios (datenorm, datenorm-hard, capitals),
# and the base of scenario images that add requirements. Runtime only: the coder's bundle is uploaded to
# /spec when a sandbox is created; gold, evaluators and provider keys never enter an image.
FROM python:3.14-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && git config --system user.name codeclimb \
  && git config --system user.email codeclimb@localhost \
  && git config --system init.defaultBranch main \
  && git config --system --add safe.directory '*'

WORKDIR /repo
ENV PYTHONDONTWRITEBYTECODE=1
CMD ["sleep", "infinity"]
