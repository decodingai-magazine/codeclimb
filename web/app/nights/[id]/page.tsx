"use client";
// One night, live and after the fact: status and Stop, KPIs (kept score, test,
// round, spend against budget, time against deadline), the current round's experiment while it
// runs, then the report: convergence, metric families, and the selected experiment's detail and
// export. `/live` is polled every 5 s;
// the report data is refetched whenever a new result row lands.
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, Kpi, Meter, StatusBadge } from "../../ui";
import { api, duration, f3, type Live, type Report, usd } from "../../worker";
import { ConvergenceChart, ConvergenceTable, FamilyHeatmap, FamilyTable } from "./report/charts";
import { derive, families, type Row, spendBreakdown } from "./report/derive";
import { DetailCard, ExportCard } from "./report/side";
import { StageTables, stageHeadlines } from "./report/stages";

function Card({ title, sub, tools, children }: { title: string; sub?: string; tools?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {sub && <span className="sub">{sub}</span>}
        {tools && <div className="tools">{tools}</div>}
      </div>
      {children}
    </section>
  );
}

function ViewToggle({ table, onToggle }: { table: boolean; onToggle: () => void }) {
  return <button type="button" className="link-btn" aria-pressed={table} onClick={onToggle}>{table ? "Chart" : "Table"}</button>;
}

/** The Spend tile: a click opens what the money went on, totalled and per experiment. */
function SpendKpi({ live, rows }: { live: Live; rows: Row[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const s = spendBreakdown(rows, live.current && !rows.some((r) => r.exp_id === live.current?.exp_id) ? [live.current] : []);
  return (
    <div className="kpi-menu" ref={root}>
      <Kpi label="Spend" value={usd(live.spend_usd)} note={`of ${usd(live.budget_usd)} budget`} open={open} onToggle={() => setOpen(!open)}>
        <Meter value={live.spend_usd} max={live.budget_usd} label="spend against budget" />
      </Kpi>
      {open && (
        <div className="kpi-panel">
          <table>
            <thead><tr><th>Spent on</th><th className="num">Total</th><th className="num">Per experiment</th></tr></thead>
            <tbody>
              <tr><td>Coding agents<span className="sub-note">coders + reviewer</span></td><td className="num">{usd(s.agents)}</td><td className="num">{usd(s.agentsEach)}</td></tr>
              <tr><td>Running and evaluating<span className="sub-note">every program run, coders&apos; tests included</span></td><td className="num">{usd(s.program)}</td><td className="num">{usd(s.programEach)}</td></tr>
            </tbody>
          </table>
          <p className="note">{s.experiments} {s.experiments === 1 ? "experiment" : "experiments"}. Evaluations count once their round is recorded.</p>
        </div>
      )}
    </div>
  );
}

/** More rounds on this night from its kept commit, with an optional direction. The next poll shows it running. */
function ContinueCard({ id, onError }: { id: string; onError: (message: string) => void }) {
  const [direction, setDirection] = useState("");
  const [count, setCount] = useState(2);
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    try {
      await api(`nights/${encodeURIComponent(id)}/continue`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ direction, rounds: count }),
      });
    } catch (e) {
      onError((e as Error).message);
      setStarting(false);
    }
  }

  return (
    <section className="card form">
      <div className="card-head"><h2>Continue this night</h2><span className="sub">more rounds from its kept commit, with what it learned</span></div>
      <label className="field">
        <span>Direction (optional)</span>
        <textarea className="input" rows={3} value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="What should the next rounds work on?" />
      </label>
      <label className="field">
        <span>Rounds</span>
        <input className="input" type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} />
      </label>
      <button className="btn" type="button" onClick={start} disabled={starting}>{starting ? "Starting…" : "Continue"}</button>
    </section>
  );
}

export default function NightPage() {
  const id = String(useParams<{ id: string }>().id);
  const [live, setLive] = useState<Live | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [convTable, setConvTable] = useState(false);
  const [heatTable, setHeatTable] = useState(false);
  const [heatMode, setHeatMode] = useState<"lineage" | "all">("lineage");
  const [chartMetric, setChartMetric] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const rowsSeen = useRef(-1);

  const loadReport = useCallback(
    () => api<Report>(`nights/${encodeURIComponent(id)}/report`).then(setReport, (e: Error) => setError(e.message)),
    [id],
  );

  useEffect(() => {
    let stopped = false;
    const load = () =>
      api<Live>(`nights/${encodeURIComponent(id)}/live`)
        .then((d) => {
          if (stopped) return;
          setLive(d);
          setError(null);
          setNow(Date.now());
          if (d.rows !== rowsSeen.current) {
            rowsSeen.current = d.rows;
            void loadReport();
          }
        })
        .catch((e: Error) => setError(e.message));
    load();
    const t = setInterval(load, 5_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [id, loadReport]);

  const night = report;
  const primary = night?.config?.primary_metric ?? live?.primary_metric ?? "accuracy";
  const v = useMemo(() => (night ? derive(night, primary) : null), [night, primary]);
  const sel = selected && v?.byId.has(selected) ? selected : v?.bestId ?? null;
  const headline = night?.config?.headline ?? [];
  const stages = night?.config?.stages ?? [];
  const multiStage = stages.length > 1 && headline.length > 0;
  const shownMetric = chartMetric ?? primary;
  const chart = useMemo(() => (night ? derive(night, shownMetric) : null), [night, shownMetric]);

  async function stop() {
    if (!confirm(`Stop night ${id}? Pi is aborted, sandboxes are destroyed, and the night gets no test score.`)) return;
    setStopping(true);
    try {
      await api(`nights/${encodeURIComponent(id)}/stop`, { method: "POST" });
    } catch (e) {
      setError((e as Error).message);
    }
    setStopping(false);
  }

  async function resume() {
    try {
      await api(`nights/${encodeURIComponent(id)}/resume`, { method: "POST" });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!live) return <main>{error ? <p className="notice">{error}</p> : <p className="muted">Loading…</p>}</main>;

  const end = live.finished_at ? Date.parse(live.finished_at) : now;
  const started = Date.parse(live.started_at);
  const elapsed = (end - started) / 1000;
  const span = (Date.parse(live.deadline_at) - started) / 1000;
  const running = live.status === "running";
  const kept = v?.cur ?? null;

  return (
    <>
      <main>
        <div className="hero">
          <div>
            <div className="eyebrow">Night · {live.scenario}</div>
            <h1 className="mono">{live.id}</h1>
            <p>
              Started {new Date(live.started_at).toLocaleString()}{live.mock ? " · mock models" : ""}{live.variation ? ` · variation ${live.variation}` : ""}
              {night?.config ? ` · up to ${night.config.max_rounds} rounds · reviewer ${night.config.reviewer_model}` : ""}
            </p>
          </div>
          <StatusBadge status={live.status} stopReason={live.stop_reason} />
          {(running || live.status === "paused") && (
            <div className="actions">
              {live.status === "paused" && <button className="btn" type="button" onClick={resume}>Resume</button>}
              <button className="btn btn-danger" type="button" onClick={stop} disabled={stopping}>
                <Icon name="stop" />{stopping ? "Stopping…" : "Stop night"}
              </button>
            </div>
          )}
        </div>
        {error && <p className="notice">{error}</p>}
        {(live.status === "finished" || live.status === "stopped") && <ContinueCard id={id} onError={setError} />}
        {live.pause && (
          <p className="notice">
            Paused (pause {live.pause.pause}, round {live.pause.round}) since {new Date(live.pause.at).toLocaleTimeString()}, out of credits. Add credits, then resume.
            {live.pause.stops.map((s) => (
              <span key={s.where} style={{ display: "block" }}>{s.where}: {s.who} on {s.model}: {s.message}</span>
            ))}
          </p>
        )}

        <div className="kpis">
          <Kpi label={`Kept ${primary}`} value={f3(kept ? v!.score(kept) : live.best)}
            note={`${kept ? kept.exp_id.replace(`${id}-`, "") : "nothing kept yet"} · threshold ${f3(live.threshold)}`} />
          {multiStage
            ? stageHeadlines(headline, stages).map(([stage, metrics]) => (
                <Kpi key={stage} label={`Test ${stage}`} value={f3(v?.lastTest?.metrics[metrics[0]])}
                  note={v?.lastTest ? metrics[0]?.replace(`${stage}.`, "") : "after the night stops"} />
              ))
            : <Kpi label="Test" value={f3(v?.score(v.lastTest))} note={v?.lastTest ? "scored once, at the end" : "after the night stops"} />}
          <Kpi label="Round" value={`${live.round} / ${live.max_rounds}`}
            note={v ? `${v.exps.length} experiments · kept in ${v.keptRounds} rounds` : undefined} />
          <SpendKpi live={live} rows={v?.rows ?? []} />
          <Kpi label="Elapsed" value={duration(elapsed)} note={running ? `deadline ${new Date(live.deadline_at).toLocaleTimeString()}` : "wall time"}>
            <Meter value={elapsed} max={span} label="time against deadline" />
          </Kpi>
        </div>

        {live.current && (
          <Card title={`Round ${live.round}`} sub="Refreshed every 5 s while the coder works.">
            <div className="branches">
              <div className="branch">
                <div className="branch-head">
                  <strong>{live.current.exp_id.replace(`${id}-`, "")}</strong>
                  <span className={`badge${live.current.phase === "coding" ? " live" : ""}`}>{live.current.phase}</span>
                </div>
                <div className="model">{live.current.model}</div>
                <div className="facts">
                  <div><span>Elapsed</span><span>{duration(live.current.elapsed_s)}</span></div>
                  <div><span>Tokens</span><span>{live.current.tokens.toLocaleString()}</span></div>
                  <div><span>Coder</span><span>{usd(live.current.coder_usd)}</span></div>
                  <div><span>Program calls</span><span>{usd(live.current.dev_usd)}</span></div>
                </div>
              </div>
            </div>
          </Card>
        )}

        {!v || !night ? (
          <Card title="Results"><div className="empty">{report ? "No results yet. The first rows land when round 1's evaluation finishes." : "Loading results…"}</div></Card>
        ) : v.exps.length === 0 ? (
          <Card title="Results"><div className="empty">No results yet. The first rows land when round 1's evaluation finishes.</div></Card>
        ) : (
          <div className="grid-2">
            <div className="stack">
              {multiStage && (
                <Card title="Stages" sub="Headline metrics per stage, ± the 95% interval, on dev; the last line is test.">
                  <StageTables nightId={id} v={v} headline={headline} stages={stages} onSelect={setSelected} />
                </Card>
              )}
              <Card title="How the Night Converged" sub={`Every experiment's ${shownMetric} on dev. The red line is the kept commit.`}
                tools={
                  <>
                    {headline.length > 0 && (
                      <select className="input" aria-label="metric" value={shownMetric} onChange={(ev) => setChartMetric(ev.target.value)}>
                        {[...new Set([primary, ...headline])].map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    )}
                    <ViewToggle table={convTable} onToggle={() => setConvTable((x) => !x)} />
                  </>
                }>
                {convTable
                  ? <ConvergenceTable nightId={id} v={chart!} primary={shownMetric} />
                  : <ConvergenceChart nightId={id} v={chart!} primary={shownMetric} selected={sel} onSelect={setSelected} />}
              </Card>
              {families(v).length > 0 && <Card title="Metric Families" sub="Share of items wrong per input family: darker means more left to fix."
                tools={
                  <>
                    <div className="seg">
                      <button type="button" aria-pressed={heatMode === "lineage"} onClick={() => setHeatMode("lineage")}>Kept lineage</button>
                      <button type="button" aria-pressed={heatMode === "all"} onClick={() => setHeatMode("all")}>All experiments</button>
                    </div>
                    <ViewToggle table={heatTable} onToggle={() => setHeatTable((x) => !x)} />
                  </>
                }>
                {heatTable
                  ? <FamilyTable nightId={id} v={v} mode={heatMode} />
                  : <FamilyHeatmap nightId={id} v={v} mode={heatMode} selected={sel} onSelect={setSelected} />}
              </Card>}
            </div>
            <aside className="side">
              <DetailCard night={night} v={v} primary={primary} selected={sel} diff={sel ? report!.diffs[sel] : undefined} />
              <ExportCard night={night} v={v} selected={sel} onSelect={setSelected} />
            </aside>
          </div>
        )}
      </main>
      <footer className="foot">
        {report ? `${report.config.scenario} · ${report.rows.length} result rows · model ${report.config.model}` : ""}
      </footer>
    </>
  );
}
