# Vendored pocock context

`skills/`: eight skill dirs of `mattpocock-skills` 1.3.1, the plugin's `skills/engineering/<skill>/` folders, the ones the `pocock` workflow loads: `implement`, `tdd`, `code-review`, `diagnosing-bugs`, `research`, `domain-modeling`, `codebase-design`, `prototype`.

- repository: https://github.com/mattpocock/skills
- commit: 49dd158d1076134a641b33efb035946536778336 (2026-10-09, plugin version 1.3.1, the commit a Claude Code install from `claude-plugins-official` recorded; byte-identical to that install's cache)
- tree sha256 of the eight dirs as upstream has them (sorted `<path> <file sha256>` lines, as in assemble.py): bcf4331f604ec4af5f95dd2792bdd27856dad1f83b3e2f59bd84d3afc835962b
- one edit, the one the benchmark spec names: `implement/SKILL.md` drops its `disable-model-invocation: true` line, so the model can call `/implement` once per ticket. Tree sha256 after the edit: 6ca5eeb0dc3a2ab2625cb019a94ecdc39d390ec1591ce2ad90ac3dbb36397f64

`scaffold/`: what the plugin's `setup-matt-pocock-skills` skill writes for a local-markdown tracker in a single-context repo, from its templates at the same commit: `docs/agents/issue-tracker.md`, `docs/agents/domain.md` and the `## Agent skills` block for `AGENTS.md`. No `triage-labels.md`: `triage` is not loaded.

Refresh: clone the repository at a new commit, replace the eight dirs, drop the flag again, update the commit and both digests here and in the spec.
