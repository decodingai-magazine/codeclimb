"use client";
// Prepare a run: pick a scenario, read its spec and dataset shape, adjust the settings, start.
// The worker validates the result with the same parser as the CLI and checks the models.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "../worker";

type Split = { items: number; folds: Record<string, number>; fields: string[] };
type ScenarioConfig = {
  sandbox: string;
  models: string[];
  reviewer_model: string;
  allowed_models: string[];
  max_rounds: number;
  deadline: string;
  timeouts: { experiment_min: number; eval_min: number };
  budget_usd: { experiment: number; night: number; eval: number; dev: number };
  primary_metric: string;
  thresholds: Record<string, number>;
  gates: Record<string, number>;
};
type Scenario = { name: string; config: ScenarioConfig; spec: Record<string, string>; dataset: { train: Split; test: Split } };
type Scenarios = { backends: string[]; mode: string; scenarios: Scenario[] };

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

export default function NewRun() {
  const router = useRouter();
  const [data, setData] = useState<Scenarios | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [doc, setDoc] = useState("SPEC.md");
  const [form, setForm] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api<Scenarios>("scenarios")
      .then((d) => {
        setData(d);
        setName(d.scenarios.find((s) => s.name === "datenorm-smoke")?.name ?? d.scenarios[0]?.name ?? "");
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const scenario = useMemo(() => data?.scenarios.find((s) => s.name === name), [data, name]);

  // Reset the form to the scenario's own settings whenever the scenario changes.
  useEffect(() => {
    if (!scenario || !data) return;
    const c = scenario.config;
    setForm({
      night_id: "",
      sandbox: data.backends.includes(c.sandbox) ? c.sandbox : data.backends[0],
      models: c.models.join("\n"),
      reviewer_model: c.reviewer_model,
      allowed_models: c.allowed_models.join("\n"),
      max_rounds: String(c.max_rounds),
      deadline: c.deadline,
      experiment_min: String(c.timeouts.experiment_min),
      eval_min: String(c.timeouts.eval_min),
      budget_experiment: String(c.budget_usd.experiment),
      budget_night: String(c.budget_usd.night),
      threshold: String(c.thresholds[c.primary_metric] ?? ""),
    });
    setDoc(Object.keys(scenario.spec).includes("SPEC.md") ? "SPEC.md" : Object.keys(scenario.spec)[0]);
  }, [scenario, data]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!scenario) return;
    const c = scenario.config;
    setStarting(true);
    setError(null);
    try {
      const overrides = {
        sandbox: form.sandbox,
        models: lines(form.models),
        reviewer_model: form.reviewer_model.trim(),
        allowed_models: lines(form.allowed_models),
        max_rounds: Number(form.max_rounds),
        deadline: form.deadline.trim(),
        timeouts: { experiment_min: Number(form.experiment_min), eval_min: Number(form.eval_min) },
        budget_usd: { ...c.budget_usd, experiment: Number(form.budget_experiment), night: Number(form.budget_night) },
        thresholds: { ...c.thresholds, [c.primary_metric]: Number(form.threshold) },
      };
      const r = await api<{ night_id: string }>("nights", {
        method: "POST",
        body: JSON.stringify({ scenario: scenario.name, night_id: form.night_id.trim() || undefined, overrides }),
      });
      router.push(`/nights/${encodeURIComponent(r.night_id)}`);
    } catch (err) {
      setError((err as Error).message);
      setStarting(false);
    }
  }

  if (!data) return <main>{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</main>;

  return (
    <main>
      <h1>New run</h1>
      <div className="row" style={{ marginBottom: 16 }}>
        <label>
          Scenario
          <select value={name} onChange={(e) => setName(e.target.value)}>
            {data.scenarios.map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
        </label>
        <span className="muted">Worker: {data.mode} Inngest, sandboxes: {data.backends.join(", ")}</span>
      </div>

      {scenario && (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
          <section className="panel">
            <div className="row" style={{ marginBottom: 8 }}>
              {Object.keys(scenario.spec).map((d) => (
                <button key={d} className={d === doc ? "primary" : ""} onClick={() => setDoc(d)} type="button">{d}</button>
              ))}
            </div>
            <pre className="doc">{scenario.spec[doc]}</pre>
            <h2>Dataset</h2>
            <p className="muted" style={{ margin: 0 }}>
              Train {scenario.dataset.train.items} items in {Object.keys(scenario.dataset.train.folds).length} folds
              ({Object.entries(scenario.dataset.train.folds).map(([f, n]) => `${f}: ${n}`).join(", ")}), test{" "}
              {scenario.dataset.test.items}. A question has {scenario.dataset.train.fields.join(", ")}; gold never leaves the worker.
            </p>
          </section>

          <form className="panel" onSubmit={start} style={{ display: "grid", gap: 12, alignContent: "start" }}>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <label>
                Night id (optional)
                <input value={form.night_id ?? ""} onChange={set("night_id")} placeholder="auto" pattern="[A-Za-z0-9][A-Za-z0-9-]{0,47}" />
              </label>
              <label>
                Sandbox
                <select value={form.sandbox ?? ""} onChange={set("sandbox")}>
                  {data.backends.map((b) => <option key={b}>{b}</option>)}
                </select>
              </label>
            </div>
            <label>
              Coder models, one per branch
              <textarea rows={3} value={form.models ?? ""} onChange={set("models")} />
            </label>
            <label>
              Reviewer model
              <input value={form.reviewer_model ?? ""} onChange={set("reviewer_model")} />
            </label>
            <label>
              Models the program may call (metered), one per line
              <textarea rows={2} value={form.allowed_models ?? ""} onChange={set("allowed_models")} />
            </label>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              <label>Max rounds<input type="number" min={1} value={form.max_rounds ?? ""} onChange={set("max_rounds")} /></label>
              <label>Deadline<input value={form.deadline ?? ""} onChange={set("deadline")} placeholder="3h" /></label>
              <label>
                Threshold ({scenario.config.primary_metric})
                <input type="number" step="any" value={form.threshold ?? ""} onChange={set("threshold")} />
              </label>
              <label>Coder minutes<input type="number" min={1} value={form.experiment_min ?? ""} onChange={set("experiment_min")} /></label>
              <label>Eval minutes<input type="number" min={1} value={form.eval_min ?? ""} onChange={set("eval_min")} /></label>
              <span />
              <label>$ per experiment<input type="number" step="any" min={0} value={form.budget_experiment ?? ""} onChange={set("budget_experiment")} /></label>
              <label>$ per night<input type="number" step="any" min={0} value={form.budget_night ?? ""} onChange={set("budget_night")} /></label>
            </div>
            {error && <p className="error">{error}</p>}
            <div className="row">
              <button className="primary" type="submit" disabled={starting}>{starting ? "Starting…" : "Start night"}</button>
              <span className="muted">Gates and the other settings come from configs/{scenario.name}.yaml.</span>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
