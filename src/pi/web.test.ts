import assert from "node:assert/strict";
import { test } from "node:test";
import type { Sandbox } from "../sandbox/types.ts";
import { sessionModel } from "./models.ts";
import { openSession, SANDBOX_TOOLS } from "./session.ts";
import { blockedUrl, fetchableUrl, guardCall, redactRepos, WEB_TOOLS } from "./web.ts";

const repos = ["decodingai-magazine/codeclimb"];

test("the project's own repository is off limits on every GitHub host; other repos and non-http schemes are not let through", () => {
	for (const url of [
		"https://github.com/decodingai-magazine/codeclimb",
		"https://github.com/DecodingAI-Magazine/codeclimb/blob/main/scenarios/graphrag/gold/log.jsonl",
		"https://raw.githubusercontent.com/decodingai-magazine/codeclimb/main/scenarios/graphrag/gold/graph.json",
		"https://codeload.github.com/decodingai-magazine/codeclimb/zip/refs/heads/main",
		"https://api.github.com/repos/decodingai-magazine/codeclimb/contents/scenarios",
	]) {
		assert.match(blockedUrl(new URL(url), repos) ?? "", /off limits/, url);
	}
	assert.equal(blockedUrl(new URL("https://github.com/decodingai-magazine/codeclimb-other"), repos), null);
	assert.equal(blockedUrl(new URL("https://github.com/olivierBinette/er-evaluation"), repos), null);
	assert.match(blockedUrl(new URL("file:///etc/passwd"), repos) ?? "", /only http/);
});

test("fetch_content reads a GitHub file as raw text and never a repo, tree, issue or video, which the plugin would clone or send to Gemini", () => {
	assert.deepEqual(fetchableUrl("https://github.com/o/r/blob/main/README.md", repos), { url: "https://raw.githubusercontent.com/o/r/main/README.md" });
	assert.deepEqual(fetchableUrl("https://docs.python.org/3/library/re.html", repos), { url: "https://docs.python.org/3/library/re.html" });
	for (const url of ["https://github.com/o/r", "https://github.com/o/r/tree/main/src", "https://github.com/o/r/pull/1", "https://www.youtube.com/watch?v=x", "not a url"]) {
		assert.ok("error" in fetchableUrl(url, repos), url);
	}
	assert.match(JSON.stringify(fetchableUrl("https://github.com/decodingai-magazine/codeclimb/blob/main/x", repos)), /off limits/);
});

test("each plugin call is pinned: direct, keyless Exa search, readable fetch, no model, proxy, browser or background turn", () => {
	const search: Record<string, unknown> = { query: "b-cubed", numResults: 3, provider: "openai", model: "x", workflow: "auto-summary", includeContent: true, proxy: "http://127.0.0.1:7422" };
	assert.equal(guardCall("web_search", search, repos), undefined);
	assert.deepEqual(search, { query: "b-cubed", numResults: 3, provider: "exa", workflow: "none", includeContent: false, proxy: "" });

	const fetch: Record<string, unknown> = { url: "https://github.com/o/r/blob/main/a.py", mode: "answer", answerModel: "anthropic/x", proxy: "http://10.0.0.1", forceClone: true, auth: true };
	assert.equal(guardCall("fetch_content", fetch, repos), undefined);
	assert.deepEqual(fetch, { url: "https://raw.githubusercontent.com/o/r/main/a.py", mode: "readable", proxy: "" });

	const many: Record<string, unknown> = { urls: ["https://a.dev/x", "https://github.com/decodingai-magazine/codeclimb/blob/main/gold.json"] };
	assert.match(guardCall("fetch_content", many, repos) ?? "", /off limits/);
	assert.equal(guardCall("get_search_content", { responseId: "r" }, repos), undefined);
	assert.match(guardCall("source_check", {}, repos) ?? "", /not available/);
	assert.match(guardCall("web_enable", {}, repos) ?? "", /not available/);
});

test("search results lose every link into a gold repository", () => {
	const text = "1. Gold\n	 https://github.com/DecodingAI-Magazine/codeclimb/blob/main/gold.json\n2. Other\n	 https://github.com/decodingai-magazine/codeclimb-other";
	const out = redactRepos(text, repos);
	assert.doesNotMatch(out, /codeclimb\/blob/);
	assert.match(out, /codeclimb-other/);
});

test("a coder session with web research has exactly the four sandbox tools and the three web tools active, after each agent start too", async () => {
	const sandbox = { name: "cc-fake", exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }), readFile: async () => "", writeFile: async () => {}, destroy: async () => {} } as unknown as Sandbox;
	const session = await openSession({ model: await sessionModel("mock/coder", "coder", true), thinking: "off", cwd: "/repo", sandbox, web: { repos } });
	try {
		const expected = [...SANDBOX_TOOLS, ...WEB_TOOLS].sort();
		assert.deepEqual(session.getActiveToolNames().sort(), expected);
		await session.prompt("go");
		assert.deepEqual(session.getActiveToolNames().sort(), expected);
	} finally {
		session.dispose();
	}
});
