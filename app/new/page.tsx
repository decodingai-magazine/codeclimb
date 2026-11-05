"use client";
// Prepare a run: pick a scenario, read its spec and dataset shape, adjust the settings, start.
// The worker validates the result with the same parser as the CLI and checks the models.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Icon, Kpi } from "../ui";
import { api } from "../worker";

type Split = { items: number; folds: Record<string, number>; fields: string[] };
type ScenarioConfig = {
  sandbox: string;
  models: string[];
  reviewer_model: string;
  allowed_models: string[];
  max_rounds: number;
  max_tokens: number | null;
  plateau_rounds: number;
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
      max_tokens: c.max_tokens == null ? "" : String(c.max_tokens),
      plateau_rounds: String(c.plateau_rounds),
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
        max_tokens: form.max_tokens.trim() ? Number(form.max_tokens) : null,
        plateau_rounds: Number(form.plateau_rounds),
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

  if (!data) return <main>{error ? <p className="notice">{error}</p> : <p className="muted">Loading…</p>}</main>;

  const train = scenario?.dataset.train;
  return (
    <main>
      <div className="hero">
        <div>
          <div className="eyebrow">New run</div>
          <h1>Start a night</h1>
          <p>Pick a scenario, read what the coders will see, adjust the settings, and start. The worker checks every model first.</p>
        </div>
        <span className="badge">{data.mode} Inngest · {data.backends.join(", ")} sandboxes</span>
      </div>

      <div className="seg" role="group" aria-label="scenario">
        {data.scenarios.map((s) => (
          <button key={s.name} type="button" aria-pressed={s.name === name} onClick={() => setName(s.name)}>{s.name}</button>
        ))}
      </div>

      {scenario && train && (
        <div className="grid-2">
          <section className="card">
            <div className="card-head">
              <h2>Scenario</h2>
              <span className="sub">What the coders see in /spec.</span>
              <div className="tools">
                <div className="seg" role="group" aria-label="document">
                  {Object.keys(scenario.spec).map((d) => (
                    <button key={d} type="button" aria-pressed={d === doc} onClick={() => setDoc(d)}>{d}</button>
                  ))}
                </div>
              </div>
            </div>
            <pre className="doc">{scenario.spec[doc]}</pre>
            <div className="kpis" style={{ marginTop: 16 }}>
              <Kpi label="Train items" value={train.items} note={`${Object.keys(train.folds).length} folds: ${Object.entries(train.folds).map(([f, n]) => `${f}: ${n}`).join(", ")}`} />
              <Kpi label="Test items" value={scenario.dataset.test.items} note="scored once, after the night stops" />
            </div>
            <p className="muted" style={{ margin: "12px 0 0" }}>
              A question has {train.fields.join(", ")}. Gold answers never leave the worker.
            </p>
          </section>

          <form className="card form" onSubmit={start}>
            <div className="card-head" style={{ margin: 0 }}>
              <h2>Settings</h2>
              <span className="sub">From configs/{scenario.name}.yaml</span>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Night id</span>
                <input className="input" value={form.night_id ?? ""} onChange={set("night_id")} placeholder="auto" pattern="[A-Za-z0-9][A-Za-z0-9-]{0,47}" />
              </label>
              <label className="field">
                <span>Sandbox</span>
                <select className="input" value={form.sandbox ?? ""} onChange={set("sandbox")}>
                  {data.backends.map((b) => <option key={b}>{b}</option>)}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Coder models, one per branch</span>
              <textarea className="input" rows={3} value={form.models ?? ""} onChange={set("models")} />
            </label>
            <label className="field">
              <span>Reviewer model</span>
              <input className="input" value={form.reviewer_model ?? ""} onChange={set("reviewer_model")} />
            </label>
            <label className="field">
              <span>Models the program may call (metered)</span>
              <textarea className="input" rows={2} value={form.allowed_models ?? ""} onChange={set("allowed_models")} placeholder="none" />
            </label>
            <div className="form-grid">
              <label className="field"><span>Max rounds</span><input className="input" type="number" min={1} value={form.max_rounds ?? ""} onChange={set("max_rounds")} /></label>
              <label className="field"><span>Stop after rounds with no gain</span><input className="input" type="number" min={0} value={form.plateau_rounds ?? ""} onChange={set("plateau_rounds")} placeholder="0 = never" /></label>
              <label className="field"><span>Token cap</span><input className="input" type="number" min={1} step={1} value={form.max_tokens ?? ""} onChange={set("max_tokens")} placeholder="no cap" /></label>
              <label className="field"><span>Deadline</span><input className="input" value={form.deadline ?? ""} onChange={set("deadline")} placeholder="3h" /></label>
              <label className="field">
                <span>Threshold · {scenario.config.primary_metric}</span>
                <input className="input" type="number" step="any" value={form.threshold ?? ""} onChange={set("threshold")} />
              </label>
              <label className="field"><span>Coder minutes</span><input className="input" type="number" min={1} value={form.experiment_min ?? ""} onChange={set("experiment_min")} /></label>
              <label className="field"><span>Eval minutes</span><input className="input" type="number" min={1} value={form.eval_min ?? ""} onChange={set("eval_min")} /></label>
              <label className="field"><span>$ per experiment</span><input className="input" type="number" step="any" min={0} value={form.budget_experiment ?? ""} onChange={set("budget_experiment")} /></label>
              <label className="field"><span>$ per night</span><input className="input" type="number" step="any" min={0} value={form.budget_night ?? ""} onChange={set("budget_night")} /></label>
            </div>
            {error && <p className="notice">{error}</p>}
            <div className="actions" style={{ marginTop: 0 }}>
              <button className="btn btn-primary" type="submit" disabled={starting}><Icon name="play" />{starting ? "Starting…" : "Start night"}</button>
              <span className="muted">Gates and the other settings come from the YAML.</span>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
