"use client";
// Views of a multi-stage scenario: one headline table per stage, and the per-kind heatmap of the
// stage that reports `by_kind` metrics. Both read the flattened metrics of the result rows.
import { f3 } from "../../../worker";
import { bin } from "./charts";
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

const BY_KIND = /^(.+)\.by_kind\.([^.]+)\.metrics\.([^.]+)\.mean$/;

/** Kinds and metrics of the `by_kind` metrics in a row. */
export function kindAxes(metrics: Row["metrics"] | undefined) {
  const parsed = Object.keys(metrics ?? {}).map((k) => BY_KIND.exec(k)).filter((m) => !!m);
  return { prefix: parsed[0]?.[1] ?? "", kinds: [...new Set(parsed.map((m) => m[2]))], names: [...new Set(parsed.map((m) => m[3]))] };
}

export function KindHeatmap({ row, label }: { row: Row | undefined; label: string }) {
  const { prefix, kinds, names } = kindAxes(row?.metrics);
  const value = (kind: string, n: string) => row?.metrics[`${prefix}.by_kind.${kind}.metrics.${n}.mean`];
  // Only rates get color: token and item counts have no "left to fix".
  const isRate = (n: string) => kinds.every((kind) => (value(kind, n) ?? 0) <= 1);
  if (!kinds.length) return <div className="empty">No per-kind metrics in {label}.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>{label}</th>{names.map((n) => <th key={n} className="num">{n}</th>)}</tr>
        </thead>
        <tbody>
          {kinds.map((kind) => (
            <tr key={kind}>
              <td>{kind}</td>
              {names.map((n) => {
                const key = `${prefix}.by_kind.${kind}.metrics.${n}.mean`;
                const val = value(kind, n);
                const b = isRate(n) ? bin(val) : -1;
                return (
                  <td key={n} className="num" title={withInterval(row?.metrics, key)}
                    style={b < 0 ? undefined : { background: `var(--heat-${b})`, color: `var(--heat-ink-${b})` }}>
                    {val == null ? "–" : f3(val)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
