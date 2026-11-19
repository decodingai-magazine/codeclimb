# Sourced by the run scripts: the one LangSmith key, from the repo's .env, when it is not exported. The benchmark uses
# the same LANGSMITH_API_KEY (and LANGSMITH_ENDPOINT) as the reference builds' .env, not a second key (operator,
# 2026-11-19): CODECLIMB_BENCH_LANGSMITH_API_KEY and CODECLIMB_BENCH_LANGSMITH_ENDPOINT fall back to them. An exported
# value wins. Never prints a value.
_bench_env_get() {  # $1: a key of the repo's .env; prints its value, without surrounding quotes
  local root; root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  [ -f "$root/.env" ] || return 0
  grep -E "^$1=" "$root/.env" | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
if [ -z "${CODECLIMB_BENCH_LANGSMITH_API_KEY:-}" ]; then
  CODECLIMB_BENCH_LANGSMITH_API_KEY="$(_bench_env_get LANGSMITH_API_KEY)"
  export CODECLIMB_BENCH_LANGSMITH_API_KEY
fi
if [ -z "${CODECLIMB_BENCH_LANGSMITH_ENDPOINT:-}" ]; then
  CODECLIMB_BENCH_LANGSMITH_ENDPOINT="$(_bench_env_get LANGSMITH_ENDPOINT)"
  [ -n "$CODECLIMB_BENCH_LANGSMITH_ENDPOINT" ] && export CODECLIMB_BENCH_LANGSMITH_ENDPOINT || unset CODECLIMB_BENCH_LANGSMITH_ENDPOINT
fi
unset -f _bench_env_get
