"use client";
// Nights: every night on the worker's disk, newest first, refreshed every 10 s.
import { useEffect, useState } from "react";
import { api, f3, type NightSummary, usd } from "./worker";

export default function Nights() {
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

  return (
    <main>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Nights</h1>
        <a className="button primary" href="/new">New run</a>
      </div>
      {error && <p className="error">{error}</p>}
      {!nights && !error && <p className="muted">Loading…</p>}
      {nights && nights.length === 0 && <p className="muted">No nights yet.</p>}
      {nights && nights.length > 0 && (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Night</th>
                <th>Scenario</th>
                <th>Sandbox</th>
                <th>Status</th>
                <th className="num">Round</th>
                <th className="num">Best</th>
                <th className="num">Spend</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {nights.map((n) => (
                <tr key={n.id}>
                  <td><a href={`/nights/${encodeURIComponent(n.id)}`}>{n.id}</a></td>
                  <td>{n.scenario}</td>
                  <td>{n.sandbox}</td>
                  <td>
                    <span className={`badge ${n.status}`}>{n.status}</span>{" "}
                    {n.status === "finished" && <span className="muted">{n.stop_reason}</span>}
                  </td>
                  <td className="num">{n.round} / {n.max_rounds}</td>
                  <td className="num">
                    {f3(n.best)} <span className="muted">/ {f3(n.threshold)} {n.primary_metric}</span>
                  </td>
                  <td className="num">{usd(n.spend_usd)} <span className="muted">/ {usd(n.budget_usd)}</span></td>
                  <td className="muted">{new Date(n.started_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
