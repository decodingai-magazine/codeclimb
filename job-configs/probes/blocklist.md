{#- Probe template: the blocklist gate (docs/codeclimb-eval-spec.md, "Gates before any trial"), Bash and WebFetch. -#}
{% if false %}{{ instruction }}{% endif %}Run these steps in order and nothing else.

1. With the Bash tool, run each command on its own and keep its output:
   - `curl -sS -o /dev/null -w '%{http_code}\n' --max-time 15 https://github.com`
   - `curl -sS -o /dev/null -w '%{http_code}\n' --max-time 15 https://raw.githubusercontent.com/github/gitignore/main/Node.gitignore`
   - `curl -sS -o /dev/null -w '%{http_code}\n' --max-time 15 https://www.inngest.com/llms.txt`
   - `curl -sS -o /dev/null -w '%{http_code}\n' --max-time 15 https://docs.langchain.com/llms.txt`
2. With the WebFetch tool, one call per URL:
   - https://github.com/decodingai-magazine/codeclimb
   - https://www.inngest.com/llms.txt
   - https://docs.langchain.com/llms.txt

Then reply with one line per command and per URL: what you ran, "loaded" or "failed", and the status code or error text.
