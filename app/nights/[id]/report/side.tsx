"use client";
// The sticky side panel: the selected experiment (metrics, cost, hypothesis, diff vs parent)
// and its export (a download from the worker, or the CLI command for a folder or git remote).
import { useState } from "react";
import type { ReportNight } from "../../../../codeclimb/report/data";
import { Icon } from "../../../ui";
import { duration, f3, fnum, signed, usd } from "../../../worker";
import { DecisionTag } from "./charts";
import { type Derived, shortId } from "./derive";

function Diff({ text }: { text: string }) {
  return (
    <pre className="diff">
      {text.split("\n").map((line, i) => {
        const cls = line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : line.startsWith("@@") ? "hunk" : null;
        return cls ? <span key={i} className={cls}>{line}</span> : `${line}\n`;
      })}
    </pre>
  );
}

export function DetailCard({ night, v, primary, selected, diff }: {
  night: ReportNight;
  v: Derived;
  primary: string;
  selected: string | null;
  diff: string | undefined;
}) {
  const e = selected ? v.byId.get(selected) : undefined;
  if (!e) return <section className="card detail"><div className="empty">Select an experiment in the chart or the table.</div></section>;
  const ps = v.parentScore(e);
  const parent = e.parent_id ? v.byId.get(e.parent_id) : undefined;
  const metricKeys = Object.keys(e.metrics ?? {}).sort((a, b) =>
    a === primary ? -1 : b === primary ? 1 : (a.startsWith("acc_") ? 0 : 1) - (b.startsWith("acc_") ? 0 : 1) || a.localeCompare(b));
  return (
    <section className="card detail" aria-live="polite">
      <div className="eyebrow">{e.exp_id === v.bestId ? "Selected · best of the night" : "Selected experiment"}</div>
      <h3 className="mono">{e.exp_id}</h3>
      <DecisionTag decision={e.decision} reason={e.keep_reason} />
      <dl className="kv">
        <dt>{primary}</dt>
        <dd>{e.decision === "error" ? "–" : f3(v.score(e)) + (ps == null ? "" : `  (${signed(v.score(e)! - ps)} vs parent)`)}</dd>
        <dt>Parent</dt>
        <dd className="mono">{parent ? `${shortId(parent.exp_id, night.id)} · ${f3(ps)}` : e.parent_id ?? "–"}</dd>
        <dt>Model</dt>
        <dd>{e.model ?? "–"}</dd>
        <dt>Commit</dt>
        <dd className="mono">{e.commit ? e.commit.slice(0, 12) : "–"}</dd>
        <dt>Cost · time</dt>
        <dd>{usd(e.coder_usd)}{e.dev_usd ? ` + ${usd(e.dev_usd)} program calls while coding` : ""} · {duration(e.t_code)} coding · {duration(e.wall_s)} total</dd>
        <dt>Tokens</dt>
        <dd>{e.tokens ? e.tokens.toLocaleString() : "–"}</dd>
      </dl>
      <div className="eyebrow quiet">{e.round === 1 ? "Coder's approach" : "Reviewer's hypothesis"}</div>
      <div className="quote">{e.hypothesis ?? "–"}</div>
      <details>
        <summary>All metrics ({metricKeys.length})</summary>
        <div className="metrics">
          {metricKeys.map((k) => <div key={k}><span>{k}</span><span>{fnum(e.metrics[k])}</span></div>)}
        </div>
      </details>
      {diff ? (
        <details>
          <summary>Diff vs parent</summary>
          <Diff text={diff} />
        </details>
      ) : (
        <div className="muted">No diff available.</div>
      )}
    </section>
  );
}

const q = (x: string) => (/^[A-Za-z0-9_./:@=-]+$/.test(x) ? x : `'${x.replace(/'/g, "'\\''")}'`);

export function ExportCard({ night, selected, resultsPath }: { night: ReportNight; selected: string | null; resultsPath: string }) {
  const [mode, setMode] = useState<"download" | "dir" | "remote">("download");
  const [copied, setCopied] = useState(false);
  const exp = selected && night.rows.some((r) => r.exp_id === selected && r.kind === "experiment" && r.commit) ? selected : null;
  const url = (format: string) => `/api/worker/nights/${encodeURIComponent(night.id)}/export/${encodeURIComponent(exp ?? "")}?format=${format}`;
  const cli = exp
    ? ["npm", "run", "export", "--", "--results", q(resultsPath), "--exp", q(exp),
       ...(mode === "remote" ? ["--to-remote", "<git-url>", "--branch", `codeclimb/${exp}`] : ["--to-dir", "<folder>", "--with-history"])].join(" ")
    : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cli);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2>Export</h2>
        <span className="sub mono">{exp ? shortId(exp, night.id) : "no committed experiment selected"}</span>
      </div>
      <div className="seg" role="group" aria-label="export destination">
        <button type="button" aria-pressed={mode === "download"} onClick={() => setMode("download")}>Download</button>
        <button type="button" aria-pressed={mode === "dir"} onClick={() => setMode("dir")}>Local folder</button>
        <button type="button" aria-pressed={mode === "remote"} onClick={() => setMode("remote")}>Git remote</button>
      </div>
      {mode === "download" ? (
        <div className="actions">
          {exp ? (
            <>
              <a className="btn btn-primary" href={url("tar.gz")}><Icon name="download" />Source .tar.gz</a>
              <a className="btn btn-ghost" href={url("bundle")}><Icon name="branch" />Git bundle</a>
            </>
          ) : (
            <span className="muted">Select a committed experiment to download it.</span>
          )}
        </div>
      ) : (
        <div className="cli">
          <div className="muted">
            {mode === "dir"
              ? "Writes the experiment's files, with its kept lineage as git history, to a folder on the worker's machine:"
              : "Pushes the experiment's lineage (starter → kept commits → this one) to a branch. Never force-pushes:"}
          </div>
          <pre>{cli || "Select a committed experiment."}</pre>
          <div className="actions">
            <button className="btn btn-primary" type="button" disabled={!exp} onClick={copy}><Icon name="copy" />{copied ? "Copied" : "Copy command"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
