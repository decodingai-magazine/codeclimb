# codeclimb-python: the sandbox runtime for Python scenarios with no fixed packages (datenorm, datenorm-hard, capitals), plus uv,
# and the base of scenario images that add requirements. Runtime only: the coder's bundle is uploaded to
# /spec when a sandbox is created; gold, evaluators and provider keys never enter an image.
FROM python:3.14-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && git config --system user.name codeclimb \
  && git config --system user.email codeclimb@localhost \
  && git config --system init.defaultBranch main \
  && git config --system --add safe.directory '*' \
  && pip install --no-cache-dir uv==0.13.5

WORKDIR /repo
ENV PYTHONDONTWRITEBYTECODE=1
# uv uses this Python, so a coder's environment and the evaluator's are built on the same one.
ENV UV_PYTHON_PREFERENCE=only-system UV_PYTHON_DOWNLOADS=never
CMD ["sleep", "infinity"]
