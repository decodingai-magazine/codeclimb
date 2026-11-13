{#- Probe template for the LangChain arm smoke trials: keeps the task's instruction (and so the arm's extra
    instructions) and replaces the work with a short check of the langchain-docs and langsmith MCPs. -#}
{{ instruction }}

---

This trial is a short probe, not the build: do not build the app and do not start any process. Instead:
1. If an MCP server named `langchain-docs` is available to you, call its search tool once (query: "LangGraph JS interrupt") and report the tool's name and the first result's title. If it is not available, say so.
2. If an MCP server named `langsmith` is available to you, call one of its read-only tools (one that lists projects or datasets) and report the tool's name and what it returned. If it is not available, say so.
3. Check that `/app/.env` holds `LANGSMITH_API_KEY` (say yes or no; never print its value).
4. Reply in under 100 words.
