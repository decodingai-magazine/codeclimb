"use client";
// Live night: status, budget and deadline, Stop, the current round's branches (refreshed every
// 5 s from code-state.json: elapsed, coder and dev spend per Pi turn), export, and the full
// report (scenario metrics, latency, cost), reloaded whenever a new result row lands.
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, duration, f3, type Live, usd } from "../../worker";

function Stat({ k, v, sub }: { k: string; v: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="stat">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      {sub}
    </div>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`bar ${value > max ? "over" : ""}`}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function NightPage() {
  const id = String(useParams<{ id: string }>().id);
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [exp, setExp] = useState("");
  const [reportKey, setReportKey] = useState(0);
  const rowsSeen = useRef(-1);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let stopped = false;
    const load = () =>
      api<Live>(`nights/${encodeURIComponent(id)}/live`)
        .then((d) => {
          if (stopped) return;
          setLive({ ...d, branches: d.branches ?? [], experiments: d.experiments ?? [] });
          setError(null);
          setNow(Date.now());
          if (d.rows !== rowsSeen.current) {
            if (rowsSeen.current >= 0) setReportKey((k) => k + 1);
            rowsSeen.current = d.rows;
          }
        })
        .catch((e: Error) => setError(e.message));
    load();
    const t = setInterval(load, 5_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [id]);

  useEffect(() => {
    if (live && !exp) setExp(live.best_exp ?? live.experiments[0]?.exp_id ?? "");
  }, [live, exp]);

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

  if (!live) return <main>{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</main>;

  const end = live.finished_at ? Date.parse(live.finished_at) : now;
  const elapsed = (end - live.started_at) / 1000;
  const span = (live.deadline_at - live.started_at) / 1000;
  const running = live.status === "running";
  const exportUrl = (format: string) =>
    `/api/worker/nights/${encodeURIComponent(id)}/export/${encodeURIComponent(exp)}?format=${format}`;

  return (
    <main>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div className="row">
          <h1 style={{ margin: 0 }}>{live.id}</h1>
          <span className={`badge ${live.status}`}>{live.status}</span>
          {live.status === "finished" && <span className="muted">{live.stop_reason}</span>}
          <span className="muted">{live.scenario} · {live.sandbox} sandboxes</span>
        </div>
        {running && (
          <button className="danger" onClick={stop} disabled={stopping}>{stopping ? "Stopping…" : "Stop night"}</button>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      <div className="panel grid" style={{ marginBottom: 16 }}>
        <Stat k="Round" v={`${live.round} / ${live.max_rounds}`} />
        <Stat
          k={`Best ${live.primary_metric}`}
          v={f3(live.best)}
          sub={<span className="muted">threshold {f3(live.threshold)}</span>}
        />
        <Stat k="Spend" v={usd(live.spend_usd)} sub={<><Bar value={live.spend_usd} max={live.budget_usd} /><span className="muted">of {usd(live.budget_usd)}</span></>} />
        <Stat k="Elapsed" v={duration(elapsed)} sub={<><Bar value={elapsed} max={span} /><span className="muted">deadline {new Date(live.deadline_at).toLocaleTimeString()}</span></>} />
      </div>

      {live.branches.length > 0 && (
        <>
          <h2>Round {live.round} branches</h2>
          <div className="grid" style={{ marginBottom: 16 }}>
            {live.branches.map((b) => (
              <div className="panel" key={b.exp_id}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>b{b.branch}</strong>
                  <span className="badge running">{b.phase}</span>
                </div>
                <div className="mono muted" style={{ margin: "4px 0 8px" }}>{b.model}</div>
                <div className="row" style={{ gap: 18 }}>
                  <Stat k="Elapsed" v={duration(b.elapsed_s)} />
                  <Stat k="Coder" v={usd(b.coder_usd)} />
                  <Stat k="Dev calls" v={usd(b.dev_usd)} />
                  <Stat k="Tokens" v={b.tokens.toLocaleString()} />
                  {b.score != null && <Stat k={live.primary_metric} v={f3(b.score)} sub={<span className="muted">{b.decision}</span>} />}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>Export</h2>
      <div className="panel row" style={{ marginBottom: 16 }}>
        {live.experiments.length === 0 ? (
          <span className="muted">No committed experiment yet.</span>
        ) : (
          <>
            <select value={exp} onChange={(e) => setExp(e.target.value)} style={{ maxWidth: "100%" }}>
              {live.experiments.map((e) => (
                <option key={e.exp_id} value={e.exp_id}>
                  {e.exp_id.replace(`${id}-`, "")} · {e.decision} · {f3(e.score)}{e.exp_id === live.best_exp ? " · best" : ""}
                </option>
              ))}
            </select>
            <a className="button primary" href={exportUrl("tar.gz")}>Download .tar.gz</a>
            <a className="button" href={exportUrl("bundle")}>Git bundle (with lineage)</a>
          </>
        )}
      </div>

      <h2>Metrics</h2>
      <iframe
        key={reportKey}
        className="report"
        title={`Report for ${id}`}
        src={`/api/worker/nights/${encodeURIComponent(id)}/report`}
      />
    </main>
  );
}
