"use client";
// Nights: every night on the worker's disk, newest first, refreshed every 10 s.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Kpi, StatusBadge } from "./ui";
import { api, f3, type NightSummary, usd } from "./worker";

export default function Nights() {
  const router = useRouter();
  const [nights, setNights] = useState<NightSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api<{ nights: NightSummary[] }>("nights")
        .then((d) => {
          setNights(d.nights);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  const running = nights?.filter((n) => n.status === "running").length ?? 0;
  const finished = nights?.filter((n) => n.status === "finished") ?? [];
  const spend = nights?.reduce((a, n) => a + n.spend_usd, 0) ?? 0;
  const open = (id: string) => router.push(`/nights/${encodeURIComponent(id)}`);

  return (
    <main>
      <div className="hero">
        <div>
          <h1>Nights</h1>
          <p>Every optimization night on this worker. Open one to watch it live or explore its results.</p>
        </div>
      </div>
      {error && <p className="notice">{error}</p>}
      {nights && nights.length > 0 && (
        <div className="kpis">
          <Kpi label="Nights" value={nights.length} note={`${finished.length} finished`} />
          <Kpi label="Running" value={running} note={running ? "live now" : "none right now"} />
          <Kpi label="Met threshold" value={finished.filter((n) => n.stop_reason === "thresholds").length} note="stopped on thresholds" />
          <Kpi label="Total spend" value={usd(spend)} note="coders, reviewer and program calls" />
        </div>
      )}
      {!nights && !error && <p className="muted">Loading…</p>}
      {nights && nights.length === 0 && (
        <section className="card"><div className="empty">No nights yet. Start one from the CLI: <code>npm run run-night -- --config configs/datenorm-smoke.yaml</code></div></section>
      )}
      {nights && nights.length > 0 && (
        <section className="card flush">
          <div className="table-wrap">
            <table className="nowrap">
              <thead>
                <tr>
                  <th>Night</th>
                  <th>Scenario</th>
                  <th>Status</th>
                  <th className="num">Round</th>
                  <th className="num">Best</th>
                  <th className="num">Spend</th>
                  <th className="num">Started</th>
                </tr>
              </thead>
              <tbody>
                {nights.map((n) => (
                  <tr key={n.id} className="link-row" onClick={() => open(n.id)}>
                    <td className="mono">
                      <a href={`/nights/${encodeURIComponent(n.id)}`} onClick={(e) => e.stopPropagation()}>{n.id}</a>
                    </td>
                    <td>{n.scenario} <span className="sub-note">· {n.sandbox}</span></td>
                    <td><StatusBadge status={n.status} stopReason={n.stop_reason} /></td>
                    <td className="num">{n.round} / {n.max_rounds}</td>
                    <td className="num">
                      <strong>{f3(n.best)}</strong> <span className="sub-note">/ {f3(n.threshold)} {n.primary_metric}</span>
                    </td>
                    <td className="num">{usd(n.spend_usd)} <span className="sub-note">/ {usd(n.budget_usd)}</span></td>
                    <td className="muted num">{new Date(n.started_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
