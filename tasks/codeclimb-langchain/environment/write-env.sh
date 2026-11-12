#!/bin/sh
# Entrypoint of the LangChain trial container: puts the operator's benchmark-only LangSmith key into /app/.env
# (the Agent Server does not boot without it), with tracing off, then runs the container's command.
if [ -n "$LANGSMITH_API_KEY" ] && ! grep -q '^LANGSMITH_API_KEY=' /app/.env 2>/dev/null; then
  { [ -s /app/.env ] && echo; printf 'LANGSMITH_API_KEY=%s\nLANGSMITH_ENDPOINT=%s\nLANGSMITH_TRACING=false\n' "$LANGSMITH_API_KEY" "$LANGSMITH_ENDPOINT"; } >> /app/.env
fi
exec "$@"
