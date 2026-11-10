"use client";
// Views of a multi-stage scenario: one headline table per stage, read from the flattened metrics of
// the result rows.
import { f3 } from "../../../worker";
import { type Derived, type Row, shortId } from "./derive";

/** The stage a headline metric belongs to: its first segment, or the only stage of the scenario. */
const stageOf = (metric: string, stages: string[]) => stages.find((s) => metric.startsWith(`${s}.`)) ?? stages[0];

/** The metric's name in its stage's table: `by_kind.single_hop.metrics.edge_recall_at_k.mean` reads `single_hop edge_recall_at_k`. */
const shortMetric = (metric: string, stage: string) =>
  metric.replace(`${stage}.`, "").replace("by_kind.", "").replace(".metrics.", " ").replace(/\.mean$/, "");

/** `<value> ±<half-width>`, when the report gave an interval. */
function withInterval(metrics: Row["metrics"] | undefined, metric: string): string {
  const half = metric.endsWith(".mean") ? metrics?.[metric.replace(/\.mean$/, ".ci95_half")] : undefined;
  return f3(metrics?.[metric]) + (half == null ? "" : ` ±${f3(half)}`);
}

export const stageHeadlines = (headline: string[], stages: string[]): [string, string[]][] =>
  stages.map((s) => [s, headline.filter((m) => stageOf(m, stages) === s)]);

/** One line per commit worth comparing: each kept commit, the test score. */
function commitRows(nightId: string, v: Derived): { key: string; label: string; row: Row }[] {
  const seen = new Set<string>();
  const kept = v.lineage.flatMap((l) => (l.exp && !seen.has(l.exp.exp_id) && seen.add(l.exp.exp_id) ? [l.exp] : []));
  return [
    ...kept.map((e) => ({ key: e.exp_id, label: shortId(e.exp_id, nightId), row: e })),
    ...(v.lastTest ? [{ key: "test", label: "test", row: v.lastTest }] : []),
  ];
}

export function StageTables({ nightId, v, headline, stages, onSelect }: {
  nightId: string;
  v: Derived;
  headline: string[];
  stages: string[];
  onSelect: (id: string) => void;
}) {
  const rows = commitRows(nightId, v);
  return (
    <div className="stack">
      {stageHeadlines(headline, stages).filter(([, metrics]) => metrics.length).map(([stage, metrics]) => (
        <div className="table-wrap" key={stage}>
          <table>
            <thead>
              <tr><th>{stage}</th>{metrics.map((m) => <th key={m} className="num">{shortMetric(m, stage)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="exp" tabIndex={0} onClick={() => onSelect(r.row.exp_id)}
                  onKeyDown={(ev) => { if (ev.key === "Enter") onSelect(r.row.exp_id); }}>
                  <td className="mono">{r.label}</td>
                  {metrics.map((m) => <td key={m} className="num">{withInterval(r.row.metrics, m)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
