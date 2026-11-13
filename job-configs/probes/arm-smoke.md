{#- Probe template for the arm smoke trials: keeps the task's instruction (and so the arm's extra instructions) and
    replaces the work with a short check of the inngest-dev MCP against the pre-started dev server. -#}
{{ instruction }}

---

This trial is a short probe, not the build: do not build the app and do not start any process. Instead:
1. Check that `curl -s http://127.0.0.1:8288` answers.
2. If an MCP server named `inngest-dev` is available to you, call one of its read-only tools (one that lists apps or functions, or searches the docs) and report the tool's name and what it returned. If it is not available, say so.
3. Reply in under 100 words.
