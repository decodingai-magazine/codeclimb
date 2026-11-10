"use client";
// The sticky side panel: the selected experiment (metrics, cost, hypothesis, diff vs parent)
// and its export (a download of the kept commit as a git repository).
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
  if (!e) return <section className="card detail"><div className="empty">Select an experiment in the chart.</div></section>;
  const ps = v.parentScore(e);
  const parent = e.parent_id ? v.byId.get(e.parent_id) : undefined;
  const metricKeys = Object.keys(e.metrics ?? {}).sort((a, b) =>
    a === primary ? -1 : b === primary ? 1 : (a.startsWith("acc_") ? 0 : 1) - (b.startsWith("acc_") ? 0 : 1) || a.localeCompare(b));
  return (
    <section className="card detail" aria-live="polite">
      <div className="eyebrow">{e.exp_id === v.bestId ? "Selected · best of the night" : "Selected experiment"}</div>
      <h3 className="mono">{e.exp_id}</h3>
      <DecisionTag decision={e.decision} />
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

/** Download a kept commit as a ready git repository: files checked out, kept lineage as history. */
export function ExportCard({ night, v, selected, onSelect }: {
  night: ReportNight;
  v: Derived;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const keptIds = v.exps.filter((e) => e.decision === "keep" && e.commit).map((e) => e.exp_id);
  const best = v.bestId && keptIds.includes(v.bestId) ? v.bestId : keptIds.at(-1) ?? null;
  const exp = selected && keptIds.includes(selected) ? selected : null;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Export</h2>
        <span className="sub mono">{exp ? shortId(exp, night.id) : "pick a kept commit"}</span>
      </div>
      {!exp ? (
        <div className="stack-sm">
          <p className="muted" style={{ margin: 0 }}>
            Only kept commits can be exported. {best ? `The night's best is ${shortId(best, night.id)}.` : "This night has kept nothing yet."}
          </p>
          {best && (
            <div className="actions">
              <button className="btn btn-primary" type="button" onClick={() => onSelect(best)}>Select the best</button>
            </div>
          )}
        </div>
      ) : (
        <div className="stack-sm">
          <div className="muted">A git repository with the files checked out on <span className="mono">codeclimb/{exp}</span> and the kept lineage as history.</div>
          <div className="actions" style={{ marginTop: 0 }}>
            <a className="btn btn-primary" href={`/api/worker/nights/${encodeURIComponent(night.id)}/export/${encodeURIComponent(exp)}?format=repo`}>
              <Icon name="download" />Download git repo
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
