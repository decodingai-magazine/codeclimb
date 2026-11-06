"use client";
// The night's tables: every experiment grouped by round, the extra evaluations, and the
// reviewer's feedback per round. Ported from codeclimb/report/client.js.
import type { ReportNight } from "../../../../codeclimb/report/data";
import { f3, fnum, signed, usd, duration } from "../../../worker";
import { DecisionTag } from "./charts";
import { type Derived, shortId } from "./derive";

export function ExperimentsTable({ night, v, primary, selected, onSelect }: {
  night: ReportNight;
  v: Derived;
  primary: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const reviewed = new Set(night.reviews.map((r) => r.round));
  const objectives = night.config?.objectives ?? [];
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th><span className="sr">Select</span></th>
            <th>Experiment</th>
            <th>Hypothesis / approach</th>
            <th className="num">{primary}</th>
            <th className="num">Δ parent</th>
            <th>Decision</th>
            {objectives.map((m) => <th key={m} className="num">{m}</th>)}
            <th className="num">Coder $</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: v.rounds }, (_, i) => i + 1).flatMap((r) => {
            const inRound = v.exps.filter((e) => e.round === r);
            const parent = inRound[0]?.parent_id ? v.byId.get(inRound[0].parent_id) : undefined;
            const kept = inRound.find((e) => e.decision === "keep");
            const source = r === 1 ? "the coder chose its own approach" : reviewed.has(r - 1) ? `hypothesis from the round ${r - 1} review` : null;
            return [
              <tr className="round-row" key={`round-${r}`}>
                <td colSpan={7 + objectives.length}>
                  <b>Round {r}</b>{"  ·  parent "}
                  <span className="mono">{parent ? shortId(parent.exp_id, night.id) : "starter"}</span>
                  {parent ? ` (${f3(v.score(parent))})` : ""}
                  {"  ·  "}{kept ? `kept ${shortId(kept.exp_id, night.id)}` : "nothing kept"}
                  {source ? `  ·  ${source}` : ""}
                </td>
              </tr>,
              ...inRound.map((e) => {
                const ps = v.parentScore(e);
                const d = e.decision === "error" || ps == null ? null : v.score(e)! - ps;
                return (
                  <tr
                    key={e.exp_id}
                    className={`exp${e.exp_id === selected ? " selected" : ""}`}
                    tabIndex={0}
                    onClick={() => onSelect(e.exp_id)}
                    onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect(e.exp_id); } }}
                  >
                    <td>
                      <input type="radio" name="pick" className="pick" aria-label={`select ${e.exp_id}`} checked={e.exp_id === selected}
                        onChange={() => onSelect(e.exp_id)} onClick={(ev) => ev.stopPropagation()} />
                    </td>
                    <td className="mono">{shortId(e.exp_id, night.id)}</td>
                    <td className="hyp"><div className="clip">{e.hypothesis ?? ""}</div></td>
                    <td className="num">{e.decision === "error" ? "–" : f3(v.score(e))}</td>
                    <td className="num"><span className={`delta ${d != null && d > 0 ? "up" : "down"}`}>{d == null ? "–" : signed(d)}</span></td>
                    <td><DecisionTag decision={e.decision} /></td>
                    {objectives.map((m) => <td key={m} className="num">{e.decision === "error" ? "–" : fnum(e.metrics[m])}</td>)}
                    <td className="num">{usd(e.coder_usd + (e.dev_usd ?? 0))}</td>
                  </tr>
                );
              }),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

const EVAL_LABEL: Record<string, string> = { test: "test" };

export function EvalsTable({ nightId, v, primary }: { nightId: string; v: Derived; primary: string }) {
  const extra = v.rows.filter((r) => r.kind !== "experiment");
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th className="num">Round</th><th>Eval</th><th>Commit</th><th>Split</th><th className="num">{primary}</th><th>Result</th><th className="num">Wall</th></tr>
        </thead>
        <tbody>
          {extra.map((r) => (
            <tr key={r.eval_id}>
              <td className="num">r{r.round}</td>
              <td>{EVAL_LABEL[r.kind] ?? r.kind}</td>
              <td className="mono">{shortId(r.exp_id, nightId)}</td>
              <td>{r.split}</td>
              <td className="num">{f3(r.metrics[primary])}</td>
              <td>{r.decision === "error" ? "error" : "ok"}</td>
              <td className="num">{duration(r.wall_s)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Reviews({ night }: { night: ReportNight }) {
  if (!night.reviews.length) return <div className="empty">No reviewer feedback yet. The reviewer writes it after each round.</div>;
  return (
    <div className="feedback">
      {night.reviews.map((r) => (
        <div className="fb" key={r.round}>
          <b>After round {r.round}</b>
          <div className="quote">{r.feedback || "(no feedback)"}</div>
          {r.hypothesis && <ol><li>{r.hypothesis}</li></ol>}
        </div>
      ))}
    </div>
  );
}
