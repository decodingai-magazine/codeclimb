// The coder's web research: pi-web-access's `web_search` (Exa's keyless hosted search) and
// `fetch_content` (a page as readable text; long pages continue with `get_search_content`), run on the
// worker host. A guard extension sits in front of them: it pins each call to what the coder needs and
// keeps it away from the project's own repository, which holds the scenarios' gold.
import { execFileSync } from "node:child_process";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import webAccess from "pi-web-access/dist/index.js";

/** The plugin's tools the coder gets. The rest (`source_check`, `web_enable`) stay inactive. */
export const WEB_TOOLS = ["web_search", "fetch_content", "get_search_content"];
const OFF_LIMITS = "this project's own repository is off limits: it holds the evaluation's gold";
const GITHUB_HOSTS = ["github.com", "www.github.com"];
const VIDEO_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"];

/** `owner/repo` of the checkout's origin on GitHub, lowercased; null without one. */
export function originRepo(dir: string): string | null {
  try {
    const url = execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i.exec(url)?.[1].toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** Why `url` is off limits for the coder, or null. `repos` are `owner/repo` slugs whose files hold gold. */
export function blockedUrl(url: URL, repos: string[]): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return `only http and https URLs, not ${url.protocol}`;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  for (const repo of repos) {
    const onGithub = [...GITHUB_HOSTS, "raw.githubusercontent.com", "codeload.github.com"].includes(host) && (path === `/${repo}` || path.startsWith(`/${repo}/`));
    const onApi = host === "api.github.com" && path.startsWith(`/repos/${repo}`);
    if (onGithub || onApi) return OFF_LIMITS;
  }
  return null;
}

/**
 * The URL `fetch_content` may read for `raw`, or why not. A file on github.com becomes its raw text;
 * any other github.com page is refused, since the plugin would answer it with `gh` or `git clone` and the
 * host's GitHub credentials. Videos are refused too: the plugin sends them to Gemini.
 */
export function fetchableUrl(raw: string, repos: string[]): { url: string } | { error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: `not a URL: ${raw}` };
  }
  const blocked = blockedUrl(url, repos);
  if (blocked) return { error: blocked };
  const host = url.hostname.toLowerCase();
  if (VIDEO_HOSTS.includes(host)) return { error: "videos are not fetched; read a page or a transcript instead" };
  if (!GITHUB_HOSTS.includes(host)) return { url: url.href };
  const file = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.pathname);
  if (file) return { url: `https://raw.githubusercontent.com/${file[1]}/${file[2]}/${file[3]}` };
  return { error: "on github.com, fetch a file by its /blob/ URL (README.md included), not a repository, tree, issue or pull request" };
}

/**
 * Pins one plugin call in place and returns why it is refused, or undefined. Every call goes direct
 * (`proxy: ""`, so no proxy can reach the worker's network), and nothing in it opens a browser, starts a
 * background turn or spends the worker's model keys.
 */
export function guardCall(tool: string, input: Record<string, unknown>, repos: string[]): string | undefined {
  if (tool === "get_search_content") return undefined;
  if (tool === "web_search") {
    for (const key of Object.keys(input)) if (!["query", "queries", "numResults", "recencyFilter", "domainFilter", "category"].includes(key)) delete input[key];
    Object.assign(input, { provider: "exa", workflow: "none", includeContent: false, proxy: "" });
    return undefined;
  }
  if (tool !== "fetch_content") return `${tool} is not available`;
  const urls = Array.isArray(input.urls) ? input.urls : [input.url];
  const checked = urls.map((u) => (typeof u === "string" ? fetchableUrl(u, repos) : { error: "url must be a string" }));
  const refused = checked.find((c) => "error" in c);
  if (refused && "error" in refused) return refused.error;
  for (const key of Object.keys(input)) delete input[key];
  const fetchable = checked.map((c) => ("url" in c ? c.url : ""));
  Object.assign(input, fetchable.length === 1 ? { url: fetchable[0] } : { urls: fetchable }, { mode: "readable", proxy: "" });
  return undefined;
}

/** Search results with every link into a gold repository cut out. */
export function redactRepos(text: string, repos: string[]): string {
  return repos.reduce(
    (t, repo) => t.replace(new RegExp(`https?://(?:www\\.|raw\\.)?github(?:usercontent)?\\.com/${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-])\\S*`, "gi"), `[${OFF_LIMITS}]`),
    text,
  );
}

/**
 * pi-web-access and its guard, for a session whose active tools are exactly `active`. The guard runs
 * after the plugin, so it also undoes the plugin's own tool selection at each session start and turn.
 */
export function webExtensions(repos: string[], active: string[]): ExtensionFactory[] {
  const guard = (pi: ExtensionAPI) => {
    const pin = () => pi.setActiveTools(active);
    pi.on("session_start", pin);
    pi.on("before_agent_start", pin);
    pi.on("tool_call", (event) => {
      if (!WEB_TOOLS.includes(event.toolName) && active.includes(event.toolName)) return undefined;
      const reason = guardCall(event.toolName, (event as { input: Record<string, unknown> }).input, repos);
      return reason ? { block: true, reason } : undefined;
    });
    pi.on("tool_result", (event) => {
      if (event.toolName !== "web_search") return undefined;
      return { content: event.content.map((c) => (c.type === "text" ? { ...c, text: redactRepos(c.text, repos) } : c)) };
    });
  };
  return [webAccess, guard];
}
