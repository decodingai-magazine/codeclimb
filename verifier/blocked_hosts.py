"""The GitHub block: one list for the trial's DNS block, Claude Code's deny rules and the leak scan.

docs/codeclimb-eval-spec.md, "Network: everything except GitHub". The DNS block lives in
tasks/shared/dind.compose.yaml (Docker needs every host name spelled out); a test checks it against DNS_NAMES.
"""

import re

# Each blocked domain, with every subdomain.
DOMAINS = ("github.com", "githubusercontent.com", "github.io", "deepwiki.com", "gitmcp.io", "sourcegraph.com", "gitee.com")
# The subdomains the DNS block names one by one: it has no wildcards.
DNS_SUBDOMAINS = {
    "github.com": ("www", "api", "codeload", "gist"),
    "githubusercontent.com": ("objects", "raw", "release-assets"),
}
DNS_NAMES = tuple(
    name for d in DOMAINS for name in (d, *(f"{sub}.{d}" for sub in DNS_SUBDOMAINS.get(d, ())))
)
# Claude Code's managed settings: WebFetch deny rules for each domain and its subdomains.
DENY_RULES = tuple(rule for d in DOMAINS for rule in (f"WebFetch(domain:{d})", f"WebFetch(domain:*.{d})"))

# The repo is decodingai-magazine/codeclimb. "codeclimb" alone is in the contracts the checks read, so the scan
# looks for the owner.
OWNER = re.compile(r"decoding[-_ ]?ai[-_ ]?magazine", re.IGNORECASE)
HOST = re.compile(
    r"(?<![a-z0-9.-])(?:[a-z0-9-]+\.)*(?:" + "|".join(re.escape(d) for d in DOMAINS) + r")(?![a-z0-9-])",
    re.IGNORECASE,
)


def hosts_in(text: str) -> list[str]:
    """Every blocked host in `text`, lowercased, in order."""
    return [m.group(0).lower() for m in HOST.finditer(text)]


def owner_in(text: str) -> list[str]:
    """Every mention of the repo owner in `text`, lowercased, in order."""
    return [m.group(0).lower() for m in OWNER.finditer(text)]


def names_in(text: str) -> list[str]:
    """Every blocked host or owner name in `text`."""
    return hosts_in(text) + owner_in(text)


def managed_settings() -> dict[str, object]:
    return {"permissions": {"deny": list(DENY_RULES)}}
