# Vendored LangChain context

`skills/<pack>/`: the `config/skills/` folder of each skill pack the `langchain-plugins` marketplace serves, whole and unedited. The commits are the ones a Claude Code install from that marketplace recorded on 2026-11-11 (its `ref` is `main`).

- `langchain-skills/` (plugin 0.1.2, 22 skills): https://github.com/langchain-ai/langchain-skills
  - commit: 126c384d8552dcb476b226c244172186cc3f4328 (2026-10-26)
  - tree sha256: 9d288e5586c21c32a15ffa99aa75044a7791fb1d7c438b91c7aeaf0f4382226f
- `langsmith-skills/` (plugin 0.1.0, 6 skills): https://github.com/langchain-ai/langsmith-skills
  - commit: 449c4e6af468997c1efb928046513736d8db448d (2026-11-05)
  - tree sha256: 0c5c920dba9f95419d5434824fad3ce01d7fc857dd76ca58a5ef179e1f56a51c

Tree sha256: sorted `<path> <file sha256>` lines, as in assemble.py. Every child dir holds a `SKILL.md`, so each pack goes into a job file as one skill root.

Refresh: clone the repository at a new commit, replace the pack's dir, update the commit and the digest here and in the spec.
