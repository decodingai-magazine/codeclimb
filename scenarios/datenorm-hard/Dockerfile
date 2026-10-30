# autocode-base-hard for the datenorm-hard scenario: the scenario's runtime + spec bundle only.
# Never the dataset, metric scripts or provider keys.
FROM python:3.14-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && git config --system user.name codeclimb \
  && git config --system user.email codeclimb@localhost \
  && git config --system init.defaultBranch main \
  && git config --system --add safe.directory '*'

COPY spec/ /spec/
WORKDIR /repo
ENV PYTHONDONTWRITEBYTECODE=1
CMD ["sleep", "infinity"]
