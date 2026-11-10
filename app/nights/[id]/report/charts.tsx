"use client";
// The night's two charts, each with a table view: how the night converged (every experiment's
// primary score per round, the kept step line, threshold and test), and the
// per-family heatmap of the share of items wrong.
import { useRef, useState } from "react";
import { f3, signed } from "../../../worker";
import { type Derived, families, niceTicks, type Row, shortId } from "./derive";

type MarkKind = "keep" | "revert" | "error" | "test" | "line" | "thr";

export function Marker({ kind, x, y, r }: { kind: MarkKind; x: number; y: number; r: number }) {
  switch (kind) {
    case "keep":
      return <circle cx={x} cy={y} r={r} fill="var(--chart-kept)" stroke="var(--surface)" strokeWidth={2} />;
    case "revert":
      return <circle cx={x} cy={y} r={r - 1} fill="var(--surface)" stroke="var(--chart-muted)" strokeWidth={2} />;
    case "error": {
      const d = r - 1;
      return <path d={`M${x - d},${y - d}L${x + d},${y + d}M${x - d},${y + d}L${x + d},${y - d}`} stroke="var(--chart-muted)" strokeWidth={2} strokeLinecap="round" />;
    }
    case "test":
      return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} rx={2} fill="var(--chart-ink)" stroke="var(--surface)" strokeWidth={2} />;
    case "line":
      return <line x1={x - 8} y1={y} x2={x + 8} y2={y} stroke="var(--chart-kept)" strokeWidth={2} strokeLinecap="round" />;
    case "thr":
      return <line x1={x - 8} y1={y} x2={x + 8} y2={y} stroke="var(--fg-3)" strokeWidth={1.5} strokeDasharray="4 3" />;
  }
}

function LegendItem({ kind, label }: { kind: MarkKind; label: string }) {
  return (
    <span>
      <svg viewBox="0 0 16 16"><Marker kind={kind} x={8} y={8} r={5} /></svg>
      {label}
    </span>
  );
}

export function DecisionTag({ decision }: { decision: Row["decision"] }) {
  return (
    <span className={`dec ${decision}`}>
      <svg viewBox="0 0 12 12"><Marker kind={decision} x={6} y={6} r={5} /></svg>
      {decision}
    </span>
  );
}

type Tip = { x: number; y: number; title: string; rows: [string, string][]; text?: string | null };

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  if (!tip) return null;
  const w = ref.current?.offsetWidth ?? 220;
  const h = ref.current?.offsetHeight ?? 80;
  const left = Math.min(Math.max(8, tip.x + 14), width - w - 8);
  return (
    <div className="tip" ref={ref} role="status" style={{ left, top: Math.max(0, tip.y - h - 12) }}>
      <b>{tip.title}</b>
      {tip.rows.map(([k, val]) => (
        <div className="row" key={k}><span>{k}</span><span>{val}</span></div>
      ))}
      {tip.text && <div className="clip" style={{ marginTop: 6 }}>{tip.text}</div>}
    </div>
  );
}

type Mark = { x: number; y: number; e: Row; kind: "keep" | "revert" | "error" | "test" };

export function ConvergenceChart({ nightId, v, primary, selected, onSelect }: {
  nightId: string;
  v: Derived;
  primary: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const W = 620, H = 300, m = { t: 16, r: 112, b: 40, l: 44 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const hasFinal = !!v.lastTest;
  const step = pw / Math.max(1, v.rounds + (hasFinal ? 1 : 0));
  const cx = (r: number) => m.l + step * (r - 0.5);
  const vals: number[] = [];
  for (const e of v.exps) if (e.decision !== "error" && v.score(e) != null) vals.push(v.score(e)!);
  for (const x of [v.threshold, v.score(v.lastTest)]) if (x != null) vals.push(x);
  let lo = vals.length ? Math.min(...vals) : 0;
  let hi = vals.length ? Math.max(...vals) : 1;
  lo = Math.floor((lo - 0.02) * 20) / 20;
  hi = Math.ceil((hi + 0.01) * 20) / 20;
  if (vals.every((x) => x <= 1) && hi > 1) hi = 1;
  if (hi - lo < 0.1) lo = hi - 0.1;
  const y = (val: number) => m.t + ph - ((val - lo) / (hi - lo)) * ph;
  const yBase = m.t + ph;

  const edge: { y: number; text: string; cls: string }[] = [];
  const thrVisible = v.threshold != null && v.threshold >= lo && v.threshold <= hi;
  if (thrVisible) edge.push({ y: y(v.threshold!), text: `threshold ${f3(v.threshold)}`, cls: "label-mid" });

  // Kept score: a step line, flat while a round keeps nothing.
  const pts = v.lineage.filter((l) => l.exp && v.score(l.exp) != null);
  let keptPath = "";
  if (pts.length) {
    keptPath = `M${cx(pts[0].round) - step * 0.35},${y(v.score(pts[0].exp)!)}`;
    for (const l of pts) keptPath += `V${y(v.score(l.exp)!)}H${cx(l.round) + step * 0.35}`;
    if (hasFinal) keptPath += `H${cx(v.rounds + 1) - step * 0.3}`;
    edge.push({ y: y(v.score(pts.at(-1)!.exp)!), text: `kept ${f3(v.score(pts.at(-1)!.exp))}`, cls: "label-strong" });
  }

  const marks: Mark[] = v.exps.map((e) => ({
    x: cx(e.round),
    y: e.decision === "error" || v.score(e) == null ? yBase - 8 : y(v.score(e)!),
    e,
    kind: e.decision,
  }));
  if (hasFinal) {
    const fx = cx(v.rounds + 1);
    if (v.lastTest && v.score(v.lastTest) != null) marks.push({ x: fx, y: y(v.score(v.lastTest)!), e: v.lastTest, kind: "test" });
  }
  if (v.lastTest && v.score(v.lastTest) != null) edge.push({ y: y(v.score(v.lastTest)!), text: `test ${f3(v.score(v.lastTest))}`, cls: "label-mid" });
  // Direct labels at the right edge, spread so they never overlap.
  edge.sort((a, b) => a.y - b.y);
  for (let i = 1; i < edge.length; i++) edge[i].y = Math.max(edge[i].y, edge[i - 1].y + 15);
  const overflow = edge.length ? edge[edge.length - 1].y - yBase : 0;
  if (overflow > 0) for (const l of edge) l.y -= overflow;

  const locate = (ev: React.MouseEvent) => {
    const box = svgRef.current!.getBoundingClientRect();
    const k = W / box.width;
    const w = wrap.current!.getBoundingClientRect();
    return { x: (ev.clientX - box.left) * k, y: (ev.clientY - box.top) * k, px: ev.clientX - w.left, py: ev.clientY - w.top };
  };
  const nearest = (p: { x: number; y: number }) => {
    let best: Mark | null = null;
    let bd = 24 * 24;
    for (const mk of marks) {
      const d = (mk.x - p.x) ** 2 + (mk.y - p.y) ** 2;
      if (d < bd) { bd = d; best = mk; }
    }
    return best;
  };
  const onMove = (ev: React.MouseEvent) => {
    const p = locate(ev);
    const mk = nearest(p);
    if (!mk) return setTip(null);
    const e = mk.e;
    const rows: [string, string][] = [[primary, f3(v.score(e))]];
    const ps = mk.kind === "keep" || mk.kind === "revert" ? v.parentScore(e) : null;
    if (ps != null) rows.push(["vs parent", signed(v.score(e)! - ps)]);
    rows.push(["decision", e.decision]);
    setTip({
      x: p.px, y: p.py, rows,
      title: mk.kind === "test" ? "Test" : shortId(e.exp_id, nightId),
      text: mk.kind === "test" ? null : e.hypothesis,
    });
  };

  return (
    <div>
      <div className="chart" ref={wrap}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${primary} per experiment and the kept score by round`}>
          <g className="grid">
            {niceTicks(lo, hi, 5).map((t) => <line key={t} x1={m.l} x2={m.l + pw} y1={y(t)} y2={y(t)} />)}
          </g>
          <g className="tick">
            {niceTicks(lo, hi, 5).map((t) => <text key={t} x={m.l - 8} y={y(t) + 4} textAnchor="end">{t.toFixed(2)}</text>)}
          </g>
          <g className="axis">
            <line x1={m.l} x2={m.l + pw} y1={yBase} y2={yBase} />
            {Array.from({ length: v.rounds }, (_, i) => (
              <text key={i} x={cx(i + 1)} y={yBase + 18} textAnchor="middle">r{i + 1}</text>
            ))}
            {hasFinal && <text x={cx(v.rounds + 1)} y={yBase + 18} textAnchor="middle">final</text>}
            <text x={m.l + pw / 2} y={H - 4} textAnchor="middle">round</text>
          </g>
          {thrVisible && (
            <line x1={m.l} x2={m.l + pw} y1={y(v.threshold!)} y2={y(v.threshold!)} stroke="var(--fg-3)" strokeWidth={1.5} strokeDasharray="4 3" />
          )}
          {keptPath && <path d={keptPath} fill="none" stroke="var(--chart-kept)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          <g>
            {marks.map((mk, i) => (
              <g key={i}>
                {selected === mk.e.exp_id && (mk.kind === "keep" || mk.kind === "revert" || mk.kind === "error") && (
                  <circle cx={mk.x} cy={mk.y} r={10} fill="none" stroke="var(--fg)" strokeWidth={1.5} />
                )}
                <Marker kind={mk.kind} x={mk.x} y={mk.y} r={5} />
              </g>
            ))}
          </g>
          {edge.map((l) => <text key={l.text} x={m.l + pw + 10} y={l.y + 4} className={l.cls}>{l.text}</text>)}
          <rect
            x={m.l - 10} y={m.t - 10} width={pw + 20} height={ph + 20} fill="transparent" style={{ cursor: "crosshair" }}
            onMouseMove={onMove}
            onMouseLeave={() => setTip(null)}
            onClick={(ev) => {
              const mk = nearest(locate(ev));
              if (mk) onSelect(mk.e.exp_id); // the test row carries the kept experiment's id
            }}
          />
        </svg>
        <Tooltip tip={tip} width={wrap.current?.clientWidth ?? 600} />
      </div>
      <div className="legend">
        <LegendItem kind="keep" label="kept" />
        <LegendItem kind="revert" label="reverted" />
        <LegendItem kind="error" label="error" />
        <LegendItem kind="line" label="kept score" />
        {v.threshold != null && <LegendItem kind="thr" label="threshold" />}
        {v.lastTest && <LegendItem kind="test" label="test" />}
      </div>
    </div>
  );
}

export function ConvergenceTable({ nightId, v, primary }: { nightId: string; v: Derived; primary: string }) {
  const finals = [
    ...(v.lastTest ? [["test", v.lastTest] as const] : []),
  ];
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th className="num">Round</th><th>Experiment</th><th className="num">{primary}</th><th className="num">Δ parent</th><th>Decision</th></tr>
        </thead>
        <tbody>
          {v.exps.map((e) => {
            const ps = v.parentScore(e);
            return (
              <tr key={e.exp_id}>
                <td className="num">r{e.round}</td>
                <td className="mono">{shortId(e.exp_id, nightId)}</td>
                <td className="num">{f3(v.score(e))}</td>
                <td className="num">{e.decision === "error" || ps == null ? "–" : signed(v.score(e)! - ps)}</td>
                <td><DecisionTag decision={e.decision} /></td>
              </tr>
            );
          })}
          {finals.map(([k, r]) => (
            <tr key={k}>
              <td className="num">final</td><td>{k}</td><td className="num">{f3(v.score(r))}</td><td className="num">–</td><td>{r.decision}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type HeatCol = { key: string; label: string; sub: string; row: Row; link?: string };

function heatColumns(nightId: string, v: Derived, mode: "lineage" | "all"): HeatCol[] {
  if (mode === "all") {
    return v.exps.filter((e) => e.decision !== "error").map((e) => ({ key: e.exp_id, label: shortId(e.exp_id, nightId), sub: e.decision, row: e }));
  }
  const cols: HeatCol[] = [];
  const seen = new Set<string>();
  for (const l of v.lineage) {
    if (l.exp && !seen.has(l.exp.exp_id)) {
      seen.add(l.exp.exp_id);
      cols.push({ key: l.exp.exp_id, label: `r${l.round}`, sub: "", row: l.exp });
    }
  }
  if (v.lastTest) cols.push({ key: "test", label: "test", sub: "", row: v.lastTest, link: v.lastTest.exp_id });
  return cols;
}

// Encode the share of items wrong (1 − accuracy): solved families recede, the remaining gaps stand out.
const BINS = [0.05, 0.15, 0.3, 0.5];
export const bin = (acc: number | null | undefined) => (acc == null ? -1 : BINS.filter((b) => 1 - acc >= b).length);

export function FamilyHeatmap({ nightId, v, mode, selected, onSelect }: {
  nightId: string;
  v: Derived;
  mode: "lineage" | "all";
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const fams = families(v);
  const cols = heatColumns(nightId, v, mode);
  if (!fams.length || !cols.length) return <div className="empty">No per-family metrics (acc_*) in this night.</div>;
  const cw = Math.max(30, Math.min(48, 640 / cols.length)), ch = 24, lw = 118, top = 40;
  const W = lw + cols.length * cw + 4, H = top + fams.length * ch + 4;
  const selCol = cols.findIndex((c) => c.key === selected);
  const show = (f: string, c: HeatCol, j: number, px: number, py: number) => {
    const val = c.row.metrics?.[f];
    const prev = j > 0 ? cols[j - 1].row.metrics?.[f] : undefined;
    const rows: [string, string][] = [
      ["column", c.label + (c.sub ? ` · ${c.sub}` : "")],
      ["accuracy", val == null ? "n/a" : f3(val)],
      ["wrong", val == null ? "n/a" : `${Math.round((1 - val) * 100)}%`],
    ];
    if (j > 0 && mode === "lineage" && c.key !== "test") rows.push(["vs previous", val == null || prev == null ? "–" : signed(val - prev)]);
    setTip({ x: px, y: py, title: f.slice(4), rows });
  };
  return (
    <div>
      <div className="chart heat-wrap" ref={wrap}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} role="img" aria-label="accuracy per input family">
          {cols.map((c, j) => (
            <g key={c.key}>
              <text x={lw + j * cw + cw / 2} y={16} textAnchor="middle" className={c.key === selected ? "label-strong" : "label-mid"}>{c.label}</text>
              {c.sub && <text x={lw + j * cw + cw / 2} y={31} textAnchor="middle">{c.sub}</text>}
            </g>
          ))}
          {fams.map((f, i) => (
            <g key={f}>
              <text x={lw - 10} y={top + i * ch + ch / 2 + 4} textAnchor="end">{f.slice(4)}</text>
              {cols.map((c, j) => {
                const val = c.row.metrics?.[f];
                const b = bin(val);
                const prev = j > 0 ? cols[j - 1].row.metrics?.[f] : undefined;
                const changed = mode === "lineage" && j > 0 && c.key !== "test" && val != null && prev != null && Math.abs(val - prev) > 1e-9;
                return (
                  <g key={c.key}>
                    <rect
                      x={lw + j * cw + 1} y={top + i * ch + 1} width={cw - 2} height={ch - 2} rx={3}
                      fill={b < 0 ? "var(--heat-none)" : `var(--heat-${b})`} className="cell" tabIndex={0}
                      aria-label={`${f.slice(4)} ${c.label}: ${val == null ? "n/a" : f3(val)}`}
                      onMouseMove={(ev) => {
                        const r = wrap.current!.getBoundingClientRect();
                        show(f, c, j, ev.clientX - r.left + wrap.current!.scrollLeft, ev.clientY - r.top);
                      }}
                      onMouseLeave={() => setTip(null)}
                      onFocus={() => show(f, c, j, lw + j * cw, top + i * ch)}
                      onBlur={() => setTip(null)}
                      onClick={() => onSelect(c.link ?? c.key)}
                      onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect(c.link ?? c.key); } }}
                    />
                    {/* A change from the previous kept commit gets a mark, so improvements stand out without color alone. */}
                    {changed && (
                      <text x={lw + j * cw + cw / 2} y={top + i * ch + ch / 2 + 4} textAnchor="middle"
                        style={{ fill: `var(--heat-ink-${b})`, fontSize: 11, fontWeight: 700, pointerEvents: "none" }}>
                        {val! > prev! ? "▲" : "▼"}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          ))}
          {selCol >= 0 && (
            <rect x={lw + selCol * cw - 1} y={top - 1} width={cw + 2} height={fams.length * ch + 2} rx={5} fill="none" stroke="var(--fg)" strokeWidth={2} pointerEvents="none" />
          )}
        </svg>
        <Tooltip tip={tip} width={wrap.current?.clientWidth ?? 600} />
      </div>
      <div className="legend">
        <span>
          share wrong <span className="muted">&lt; 5%</span>
          <span className="ramp">{[0, 1, 2, 3, 4].map((b) => <i key={b} style={{ background: `var(--heat-${b})` }} />)}</span>
          <span className="muted">≥ 50%</span>
        </span>
        <span><span className="ramp"><i style={{ background: "var(--heat-none)" }} /></span>n/a</span>
        {mode === "lineage" && <span>▲ ▼ changed vs previous kept commit</span>}
      </div>
    </div>
  );
}

export function FamilyTable({ nightId, v, mode }: { nightId: string; v: Derived; mode: "lineage" | "all" }) {
  const fams = families(v);
  const cols = heatColumns(nightId, v, mode);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Family</th>{cols.map((c) => <th key={c.key} className="num">{c.label}{c.sub ? ` ${c.sub}` : ""}</th>)}</tr>
        </thead>
        <tbody>
          {fams.map((f) => (
            <tr key={f}><td>{f.slice(4)}</td>{cols.map((c) => <td key={c.key} className="num">{f3(c.row.metrics?.[f])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
