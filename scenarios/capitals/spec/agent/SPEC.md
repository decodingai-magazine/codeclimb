# capitals: name a country's capital

Build a command-line program that answers, for each country it is given, the name of that country's capital city.

## Program contract

- Language: Python 3.14, **standard library only**. You cannot `pip install` anything.
- Entry point: `python3 -m capitals`, run from the repository root.
- Input: JSON Lines on stdin. Each line is one item: `{"id": "<string>", "country": "<string>"}`.
- Output: for every input line, write exactly one JSON line to stdout, in input order: `{"id": "<same id>", "capital": "<city>"}`, or `{"id": "<same id>", "capital": null}` when unsure.
- The caller sends one line, then waits for its answer before sending the next. Flush stdout after every line.
- Never crash on bad input. Write nothing else to stdout (use stderr for logs).

## Model access

The program may call a language model through an OpenAI-compatible chat completions endpoint, during evaluation and while you develop:

- Base URL: the `OPENAI_BASE_URL` environment variable (requests go to `$OPENAI_BASE_URL/chat/completions`).
- Key: the `OPENAI_API_KEY` environment variable, sent as `Authorization: Bearer <key>`.
- Model: `github-copilot/claude-haiku-4.5`. Text messages only; no streaming, no tools.

Every call costs money and time. During evaluation both are measured; while you develop, calls come out of a small budget, and the endpoint answers `402` once it is spent. There is no other network access.

The starter repository calls the model once per country.
