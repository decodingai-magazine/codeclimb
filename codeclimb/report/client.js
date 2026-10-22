// CodeClimb report page. Plain browser JS, inlined by html.ts; no network, no
// framework. All text from the data (hypotheses, feedback, diffs) is LLM- or
// git-generated, so it is only ever set as textContent, never as HTML.
(() => {
  "use strict";
  const boot = JSON.parse(document.getElementById("cc-boot").textContent);
  const D = boot.data;
  const P = D.primaryMetric;
  const SVGNS = "http://www.w3.org/2000/svg";

  // ---------- small helpers ----------
  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "style") n.setAttribute("style", v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  function s(tag, attrs, ...kids) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v);
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  const ICONS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
    branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    table: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
    chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  };
  function icon(name) {
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = ICONS[name]; // static markup from this file, never data
    return svg;
  }
  const f3 = (v) => (v == null || Number.isNaN(v) ? "–" : Number(v).toFixed(3));
  const signed = (v) => (v == null ? "–" : (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(3));
  const usd = (v) => (v == null ? "–" : "$" + Number(v).toFixed(v < 1 ? 3 : 2));
  const secs = (v) => {
    if (v == null) return "–";
    if (v < 90) return Math.round(v) + " s";
    if (v < 5400) return Math.round(v / 60) + " min";
    return (v / 3600).toFixed(1) + " h";
  };
  const branchOf = (id) => {
    const m = /-b(\d+)$/.exec(id);
    return m ? Number(m[1]) : 0;
  };
  const shortId = (id, night) => id.replace(night + "-", "");
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked: the page still works */ } },
  };

  // ---------- theme ----------
  const root = document.documentElement;
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function applyTheme() {
    const t = store.get("cc-theme");
    if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
    else root.removeAttribute("data-theme");
    root.classList.toggle("auto-dark", !t && !!mq && mq.matches);
  }
  const isDark = () => root.getAttribute("data-theme") === "dark" || root.classList.contains("auto-dark");
  applyTheme();
  if (mq && mq.addEventListener) mq.addEventListener("change", () => { applyTheme(); render(); });

  // ---------- derived per-night views ----------
  function derive(night) {
    const rows = night.rows;
    const exps = rows.filter((r) => r.kind === "experiment").sort((a, b) => a.round - b.round || branchOf(a.exp_id) - branchOf(b.exp_id));
    const byId = new Map(exps.map((e) => [e.exp_id, e]));
    const rounds = exps.reduce((m, e) => Math.max(m, e.round), 0);
    const lineage = [];
    let cur = null;
    for (let r = 1; r <= rounds; r++) {
      const k = exps.find((e) => e.round === r && e.decision === "keep");
      if (k) cur = k;
      lineage.push({ round: r, exp: cur, keptThisRound: !!k });
    }
    const pick = (kind) => rows.filter((r) => r.kind === kind);
    const val = pick("validation");
    const test = pick("test");
    const score = (e) => (e && e.metrics ? e.metrics[P] : null);
    const parentScore = (e) => {
      const p = byId.get(e.parent_id);
      return p ? score(p) : null;
    };
    const threshold = night.config && night.config.thresholds ? night.config.thresholds[P] : null;
    const bestId = (night.done && night.done.kept && night.done.kept.exp_id) || (cur && cur.exp_id) || (exps[0] && exps[0].exp_id) || null;
    const counts = { keep: 0, revert: 0, error: 0 };
    for (const e of exps) counts[e.decision] = (counts[e.decision] || 0) + 1;
    const keptRounds = lineage.filter((l) => l.keptThisRound).length;
    const lastVal = val[val.length - 1] || null;
    const lastTest = test[test.length - 1] || null;
    const durS = night.startedAt && night.finishedAt ? (Date.parse(night.finishedAt) - night.startedAt) / 1000 : null;
    return { rows, exps, byId, rounds, lineage, val, test, lastVal, lastTest, score, parentScore, threshold, bestId, counts, keptRounds, durS, cur };
  }

  // ---------- state ----------
  const nights = D.nights;
  const state = {
    night: (nights.find((n) => n.id === store.get("cc-night")) || nights[nights.length - 1] || {}).id,
    sel: null,
    heat: "lineage",
    convTable: false,
    heatTable: false,
    exportMode: "dir",
    exportForm: { dir: "", withHistory: false, force: false, url: "", branch: "" },
  };
  const tip = h("div", { class: "tip", role: "status", "aria-live": "polite" });

  function showTip(container, x, y, nodes) {
    tip.replaceChildren(...nodes);
    if (tip.parentNode !== container) container.append(tip);
    tip.classList.add("on");
    const cw = container.clientWidth;
    const tw = tip.offsetWidth;
    const left = Math.min(Math.max(8, x + 14), cw - tw - 8);
    tip.style.left = left + "px";
    tip.style.top = Math.max(0, y - tip.offsetHeight - 12) + "px";
  }
  const hideTip = () => tip.classList.remove("on");
  const tipRow = (k, v) => h("div", { class: "row" }, h("span", { text: k }), h("span", { text: v }));

  // ---------- markers (shared by chart, legend, table) ----------
  function marker(kind, x, y, r) {
    if (kind === "keep") return s("circle", { cx: x, cy: y, r, fill: "var(--chart-kept)", stroke: "var(--surface)", "stroke-width": 2 });
    if (kind === "revert") return s("circle", { cx: x, cy: y, r: r - 1, fill: "var(--surface)", stroke: "var(--chart-muted)", "stroke-width": 2 });
    if (kind === "error") {
      const d = r - 1;
      return s("path", { d: `M${x - d},${y - d}L${x + d},${y + d}M${x - d},${y + d}L${x + d},${y - d}`, stroke: "var(--chart-muted)", "stroke-width": 2, "stroke-linecap": "round" });
    }
    if (kind === "val") return s("path", { d: `M${x},${y - r - 1}L${x + r + 1},${y}L${x},${y + r + 1}L${x - r - 1},${y}Z`, fill: "var(--chart-ink)", stroke: "var(--surface)", "stroke-width": 2 });
    if (kind === "test") return s("rect", { x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: 2, fill: "var(--chart-ink)", stroke: "var(--surface)", "stroke-width": 2 });
    if (kind === "line") return s("line", { x1: x - 8, y1: y, x2: x + 8, y2: y, stroke: "var(--chart-kept)", "stroke-width": 2, "stroke-linecap": "round" });
    if (kind === "thr") return s("line", { x1: x - 8, y1: y, x2: x + 8, y2: y, stroke: "var(--fg-3)", "stroke-width": 1.5, "stroke-dasharray": "4 3" });
    return null;
  }
  function legendItem(kind, label) {
    const svg = s("svg", { viewBox: "0 0 16 16" }, marker(kind, 8, 8, 5));
    return h("span", null, svg, label);
  }
  function decisionTag(d) {
    const svg = s("svg", { viewBox: "0 0 12 12" }, marker(d, 6, 6, 5));
    return h("span", { class: "dec " + d }, svg, d);
  }

  function niceTicks(lo, hi, n) {
    const span = hi - lo || 1;
    const step0 = span / n;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => span / st <= n) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
    return out;
  }

  // ---------- convergence chart ----------
  function convergenceChart(night, v) {
    const W = 620, H = 300, m = { t: 16, r: 112, b: 40, l: 44 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const hasFinal = !!(v.lastVal || v.lastTest);
    const slots = v.rounds + (hasFinal ? 1 : 0);
    const step = pw / Math.max(1, slots);
    const cx = (r) => m.l + step * (r - 0.5);
    const B = night.config && night.config.models ? night.config.models.length : Math.max(1, ...v.exps.map((e) => branchOf(e.exp_id) + 1));
    const off = Math.min(14, step / (B + 1));
    const vals = [];
    for (const e of v.exps) if (e.decision !== "error") vals.push(v.score(e));
    if (v.threshold != null) vals.push(v.threshold);
    if (v.lastVal) vals.push(v.score(v.lastVal));
    if (v.lastTest) vals.push(v.score(v.lastTest));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    lo = Math.floor((lo - 0.02) * 20) / 20;
    hi = Math.ceil((hi + 0.01) * 20) / 20;
    if (vals.every((x) => x <= 1) && hi > 1) hi = 1;
    if (hi - lo < 0.1) lo = hi - 0.1;
    const y = (val) => m.t + ph - ((val - lo) / (hi - lo)) * ph;
    const yBase = m.t + ph;

    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${P} per experiment and the kept score by round` });
    const grid = s("g", { class: "grid" });
    const ticks = s("g", { class: "tick" });
    for (const t of niceTicks(lo, hi, 5)) {
      grid.append(s("line", { x1: m.l, x2: m.l + pw, y1: y(t), y2: y(t) }));
      ticks.append(s("text", { x: m.l - 8, y: y(t) + 4, "text-anchor": "end" }, t.toFixed(2)));
    }
    svg.append(grid, ticks);
    const axis = s("g", { class: "axis" }, s("line", { x1: m.l, x2: m.l + pw, y1: yBase, y2: yBase }));
    for (let r = 1; r <= v.rounds; r++) axis.append(s("text", { x: cx(r), y: yBase + 18, "text-anchor": "middle" }, "r" + r));
    if (hasFinal) axis.append(s("text", { x: cx(v.rounds + 1), y: yBase + 18, "text-anchor": "middle" }, "final"));
    axis.append(s("text", { x: m.l + pw / 2, y: H - 4, "text-anchor": "middle" }, "round"));
    svg.append(axis);

    // Direct labels at the right edge; laid out together below so they never overlap.
    const edge = [];
    if (v.threshold != null && v.threshold >= lo && v.threshold <= hi) {
      svg.append(s("line", { x1: m.l, x2: m.l + pw, y1: y(v.threshold), y2: y(v.threshold), stroke: "var(--fg-3)", "stroke-width": 1.5, "stroke-dasharray": "4 3" }));
      edge.push({ y: y(v.threshold), text: "threshold " + f3(v.threshold), cls: "label-mid" });
    }

    // Kept score: a step line, flat while a round keeps nothing.
    const pts = v.lineage.filter((l) => l.exp);
    if (pts.length) {
      let d = `M${cx(pts[0].round) - step * 0.35},${y(v.score(pts[0].exp))}`;
      for (const l of pts) d += `V${y(v.score(l.exp))}H${cx(l.round) + step * 0.35}`;
      if (hasFinal) d += `H${cx(v.rounds + 1) - step * 0.3}`;
      svg.append(s("path", { d, fill: "none", stroke: "var(--chart-kept)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      const last = pts[pts.length - 1];
      edge.push({ y: y(v.score(last.exp)), text: "kept " + f3(v.score(last.exp)), cls: "label-strong" });
    }

    const marks = [];
    for (const e of v.exps) {
      const b = branchOf(e.exp_id);
      const x = cx(e.round) + (b - (B - 1) / 2) * off;
      const yy = e.decision === "error" ? yBase - 8 : y(v.score(e));
      marks.push({ x, y: yy, e, kind: e.decision });
    }
    if (hasFinal) {
      const fx = cx(v.rounds + 1);
      if (v.lastVal) marks.push({ x: fx - 8, y: y(v.score(v.lastVal)), e: v.lastVal, kind: "val" });
      if (v.lastTest) marks.push({ x: fx + 8, y: y(v.score(v.lastTest)), e: v.lastTest, kind: "test" });
    }
    const markG = s("g");
    for (const mk of marks) {
      const sel = state.sel && mk.e.exp_id === state.sel && (mk.kind === "keep" || mk.kind === "revert" || mk.kind === "error");
      if (sel) markG.append(s("circle", { cx: mk.x, cy: mk.y, r: 10, fill: "none", stroke: "var(--fg)", "stroke-width": 1.5 }));
      markG.append(marker(mk.kind, mk.x, mk.y, 5));
    }
    svg.append(markG);
    if (v.lastVal) edge.push({ y: y(v.score(v.lastVal)), text: "val " + f3(v.score(v.lastVal)), cls: "label-mid" });
    if (v.lastTest) edge.push({ y: y(v.score(v.lastTest)), text: "test " + f3(v.score(v.lastTest)), cls: "label-mid" });
    edge.sort((a, b) => a.y - b.y);
    const GAP = 15;
    for (let i = 1; i < edge.length; i++) edge[i].y = Math.max(edge[i].y, edge[i - 1].y + GAP);
    const overflow = edge.length ? edge[edge.length - 1].y - yBase : 0;
    if (overflow > 0) for (const l of edge) l.y -= overflow;
    for (const l of edge) svg.append(s("text", { x: m.l + pw + 10, y: l.y + 4, class: l.cls }, l.text));

    const wrap = h("div", { class: "chart" }, svg);
    const hit = s("rect", { x: m.l - 10, y: m.t - 10, width: pw + 20, height: ph + 20, fill: "transparent", style: "cursor:crosshair" });
    svg.append(hit);
    const toLocal = (ev) => {
      const pt = svg.getBoundingClientRect();
      const k = W / pt.width;
      return { x: (ev.clientX - pt.left) * k, y: (ev.clientY - pt.top) * k, px: ev.clientX - wrap.getBoundingClientRect().left, py: ev.clientY - wrap.getBoundingClientRect().top };
    };
    const nearest = (p) => {
      let best = null, bd = 24 * 24;
      for (const mk of marks) {
        const d = (mk.x - p.x) ** 2 + (mk.y - p.y) ** 2;
        if (d < bd) { bd = d; best = mk; }
      }
      return best;
    };
    hit.addEventListener("mousemove", (ev) => {
      const p = toLocal(ev);
      const mk = nearest(p);
      if (!mk) return hideTip();
      const e = mk.e;
      const nodes = [h("b", { text: mk.kind === "val" ? "Validation" : mk.kind === "test" ? "Test" : shortId(e.exp_id, night.id) })];
      nodes.push(tipRow(P, f3(v.score(e))));
      if ((mk.kind === "keep" || mk.kind === "revert") && v.parentScore(e) != null) nodes.push(tipRow("vs parent", signed(v.score(e) - v.parentScore(e))));
      if (mk.kind === "val" && e.metrics && e.metrics.gap != null) nodes.push(tipRow("gap", f3(e.metrics.gap)));
      nodes.push(tipRow("decision", mk.kind === "val" ? (e.decision === "keep" ? "no overfit" : "overfit") : e.decision));
      if (e.hypothesis && mk.kind !== "val" && mk.kind !== "test") nodes.push(h("div", { class: "clip", style: "margin-top:6px", text: e.hypothesis }));
      showTip(wrap, p.px, p.py, nodes);
    });
    hit.addEventListener("mouseleave", hideTip);
    hit.addEventListener("click", (ev) => {
      const mk = nearest(toLocal(ev));
      if (!mk) return;
      select(mk.e.exp_id); // val/test rows carry the kept experiment's id
    });

    const legend = h("div", { class: "legend" },
      legendItem("keep", "kept"), legendItem("revert", "reverted"), legendItem("error", "error"),
      legendItem("line", "kept score"), v.threshold != null ? legendItem("thr", "threshold") : null,
      v.lastVal ? legendItem("val", "validation") : null, v.lastTest ? legendItem("test", "test") : null);
    return h("div", null, wrap, legend);
  }

  function convergenceTable(night, v) {
    const body = v.exps.map((e) => h("tr", null,
      h("td", { class: "num", text: "r" + e.round }), h("td", { class: "mono", text: shortId(e.exp_id, night.id) }),
      h("td", { class: "num", text: f3(v.score(e)) }), h("td", { class: "num", text: e.decision === "error" || v.parentScore(e) == null ? "–" : signed(v.score(e) - v.parentScore(e)) }),
      h("td", null, decisionTag(e.decision))));
    const extra = [].concat(v.lastVal ? [["validation", v.lastVal]] : [], v.lastTest ? [["test", v.lastTest]] : [])
      .map(([k, r]) => h("tr", null, h("td", { class: "num", text: "final" }), h("td", { text: k }), h("td", { class: "num", text: f3(v.score(r)) }), h("td", { class: "num", text: "–" }), h("td", { text: r.decision })));
    return h("div", { class: "table-wrap" }, h("table", null,
      h("thead", null, h("tr", null, h("th", { class: "num", text: "Round" }), h("th", { text: "Experiment" }), h("th", { class: "num", text: P }), h("th", { class: "num", text: "Δ parent" }), h("th", { text: "Decision" }))),
      h("tbody", null, body, extra)));
  }

  // ---------- family heatmap ----------
  function heatColumns(night, v) {
    if (state.heat === "all") return v.exps.filter((e) => e.decision !== "error").map((e) => ({ key: e.exp_id, label: shortId(e.exp_id, night.id), sub: e.decision, row: e }));
    const cols = [];
    const seen = new Set();
    for (const l of v.lineage) if (l.exp && !seen.has(l.exp.exp_id)) { seen.add(l.exp.exp_id); cols.push({ key: l.exp.exp_id, label: "r" + l.round, sub: "b" + branchOf(l.exp.exp_id), row: l.exp }); }
    if (v.lastVal) cols.push({ key: "val", label: "val", sub: "fold " + v.lastVal.val_fold, row: v.lastVal, link: v.lastVal.exp_id });
    if (v.lastTest) cols.push({ key: "test", label: "test", sub: "", row: v.lastTest, link: v.lastTest.exp_id });
    return cols;
  }
  // Encode the share of items wrong (1 − accuracy): solved families recede, the remaining gaps stand out.
  const BINS = [0.05, 0.15, 0.3, 0.5];
  const bin = (acc) => (acc == null ? -1 : BINS.filter((b) => 1 - acc >= b).length);
  function families(v) {
    const fams = [];
    for (const r of v.rows) for (const k of Object.keys(r.metrics || {})) if (k.startsWith("acc_") && !fams.includes(k)) fams.push(k);
    return fams;
  }
  function heatmap(night, v) {
    const fams = families(v);
    const cols = heatColumns(night, v);
    if (!fams.length || !cols.length) return h("div", { class: "empty", text: "No per-family metrics (acc_*) in this night." });
    const cw = Math.max(30, Math.min(48, 640 / cols.length)), ch = 24, lw = 118, top = 40;
    const W = lw + cols.length * cw + 4, H = top + fams.length * ch + 4;
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, role: "img", "aria-label": "accuracy per input family" });
    cols.forEach((c, j) => {
      const x = lw + j * cw + cw / 2;
      svg.append(s("text", { x, y: 16, "text-anchor": "middle", class: c.key === state.sel ? "label-strong" : "label-mid" }, c.label));
      if (c.sub) svg.append(s("text", { x, y: 31, "text-anchor": "middle" }, c.sub));
    });
    const wrap = h("div", { class: "chart heat-wrap" });
    fams.forEach((f, i) => {
      svg.append(s("text", { x: lw - 10, y: top + i * ch + ch / 2 + 4, "text-anchor": "end" }, f.slice(4)));
      cols.forEach((c, j) => {
        const val = c.row.metrics ? c.row.metrics[f] : null;
        const b = bin(val);
        const prev = j > 0 ? cols[j - 1].row.metrics[f] : null;
        const rect = s("rect", {
          x: lw + j * cw + 1, y: top + i * ch + 1, width: cw - 2, height: ch - 2, rx: 3,
          fill: b < 0 ? "var(--heat-none)" : `var(--heat-${b})`, class: "cell",
          tabindex: "0", "aria-label": `${f.slice(4)} ${c.label}: ${val == null ? "n/a" : f3(val)}`,
        });
        const show = (px, py) => showTip(wrap, px, py, [h("b", { text: f.slice(4) }), tipRow("column", c.label + (c.sub ? " · " + c.sub : "")), tipRow("accuracy", val == null ? "n/a" : f3(val)), tipRow("wrong", val == null ? "n/a" : Math.round((1 - val) * 100) + "%"), j > 0 && state.heat === "lineage" && c.key !== "val" && c.key !== "test" ? tipRow("vs previous", val == null || prev == null ? "–" : signed(val - prev)) : null].filter(Boolean));
        rect.addEventListener("mousemove", (ev) => { const r = wrap.getBoundingClientRect(); show(ev.clientX - r.left + wrap.scrollLeft, ev.clientY - r.top); });
        rect.addEventListener("mouseleave", hideTip);
        rect.addEventListener("focus", () => show(lw + j * cw, top + i * ch));
        rect.addEventListener("blur", hideTip);
        rect.addEventListener("click", () => select(c.link || c.key));
        // A change from the previous lineage column gets a small mark, so improvements stand out without color alone.
        svg.append(rect);
        if (state.heat === "lineage" && j > 0 && c.key !== "val" && c.key !== "test" && val != null && prev != null && Math.abs(val - prev) > 1e-9) {
          svg.append(s("text", { x: lw + j * cw + cw / 2, y: top + i * ch + ch / 2 + 4, "text-anchor": "middle", style: `fill: var(--heat-ink-${b}); font-size: 11px; font-weight: 700; pointer-events: none` }, val > prev ? "▲" : "▼"));
        }
      });
    });
    const selCol = cols.findIndex((c) => c.key === state.sel);
    if (selCol >= 0) svg.append(s("rect", { x: lw + selCol * cw - 1, y: top - 1, width: cw + 2, height: fams.length * ch + 2, rx: 5, fill: "none", stroke: "var(--fg)", "stroke-width": 2, "pointer-events": "none" }));
    wrap.append(svg);
    const ramp = h("span", { class: "ramp" }, [0, 1, 2, 3, 4].map((b) => h("i", { style: `background: var(--heat-${b})` })));
    const legend = h("div", { class: "legend" },
      h("span", null, "share wrong", h("span", { class: "muted", text: "< 5%" }), ramp, h("span", { class: "muted", text: "≥ 50%" })),
      h("span", null, h("span", { class: "ramp" }, h("i", { style: "background: var(--heat-none)" })), "n/a"),
      state.heat === "lineage" ? h("span", null, "▲ ▼ changed vs previous kept commit") : null);
    return h("div", null, wrap, legend);
  }
  function heatTable(night, v) {
    const fams = families(v);
    const cols = heatColumns(night, v);
    return h("div", { class: "table-wrap" }, h("table", null,
      h("thead", null, h("tr", null, h("th", { text: "Family" }), cols.map((c) => h("th", { class: "num", text: c.label + (c.sub ? " " + c.sub : "") })))),
      h("tbody", null, fams.map((f) => h("tr", null, h("td", { text: f.slice(4) }), cols.map((c) => h("td", { class: "num", text: f3(c.row.metrics[f]) })))))));
  }

  // ---------- experiments table ----------
  function experimentsTable(night, v) {
    const reviewFor = new Map(night.reviews.map((r) => [r.round, r]));
    const body = [];
    for (let r = 1; r <= v.rounds; r++) {
      const inRound = v.exps.filter((e) => e.round === r);
      const parent = inRound[0] ? v.byId.get(inRound[0].parent_id) : null;
      const kept = inRound.find((e) => e.decision === "keep");
      body.push(h("tr", { class: "round-row" }, h("td", { colspan: 7 },
        h("b", { text: "Round " + r }), "  ·  parent ",
        h("span", { class: "mono", text: parent ? shortId(parent.exp_id, night.id) : "starter" }),
        parent ? " (" + f3(v.score(parent)) + ")" : "",
        "  ·  ", kept ? "kept " + shortId(kept.exp_id, night.id) : "nothing kept",
        r === 1 ? "  ·  coders chose their own approach" : reviewFor.has(r - 1) ? "  ·  hypotheses from the round " + (r - 1) + " review" : "")));
      for (const e of inRound) {
        const ps = v.parentScore(e);
        const d = e.decision === "error" || ps == null ? null : v.score(e) - ps;
        const tr = h("tr", { class: "exp" + (e.exp_id === state.sel ? " selected" : ""), tabindex: "0", "data-exp": e.exp_id, onclick: () => select(e.exp_id), onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(e.exp_id); } } },
          h("td", null, h("input", { type: "radio", name: "pick", class: "pick", "aria-label": "select " + e.exp_id, checked: e.exp_id === state.sel, onclick: (ev) => { ev.stopPropagation(); select(e.exp_id); } })),
          h("td", { class: "mono", text: shortId(e.exp_id, night.id) }),
          h("td", { class: "hyp" }, h("div", { class: "clip", text: e.hypothesis || "" })),
          h("td", { class: "num", text: e.decision === "error" ? "–" : f3(v.score(e)) }),
          h("td", { class: "num" }, h("span", { class: "delta " + (d > 0 ? "up" : "down"), text: d == null ? "–" : signed(d) })),
          h("td", null, decisionTag(e.decision)),
          h("td", { class: "num", text: usd(e.coder_usd) }));
        body.push(tr);
      }
    }
    return h("div", { class: "table-wrap" }, h("table", null,
      h("thead", null, h("tr", null, h("th", null, h("span", { class: "sr", text: "Select" })), h("th", { text: "Experiment" }), h("th", { text: "Hypothesis / approach" }), h("th", { class: "num", text: P }), h("th", { class: "num", text: "Δ parent" }), h("th", { text: "Decision" }), h("th", { class: "num", text: "Coder $" }))),
      h("tbody", null, body)));
  }

  function evalsTable(night, v) {
    const extra = v.rows.filter((r) => r.kind !== "experiment");
    if (!extra.length) return null;
    const label = { rescore: "re-score", noise: "noise", validation: "validation", test: "test" };
    return h("div", { class: "table-wrap" }, h("table", null,
      h("thead", null, h("tr", null, h("th", { class: "num", text: "Round" }), h("th", { text: "Eval" }), h("th", { text: "Commit" }), h("th", { text: "Split" }), h("th", { class: "num", text: P }), h("th", { text: "Result" }), h("th", { class: "num", text: "Wall" }))),
      h("tbody", null, extra.map((r) => h("tr", null,
        h("td", { class: "num", text: "r" + r.round }), h("td", { text: label[r.kind] || r.kind }), h("td", { class: "mono", text: shortId(r.exp_id, night.id) }),
        h("td", { text: r.split + (r.kind === "validation" ? " · fold " + r.val_fold : "") }), h("td", { class: "num", text: f3(r.metrics[P]) }),
        h("td", { text: r.kind === "validation" ? (r.decision === "keep" ? "no overfit (gap " + f3(r.metrics.gap) + ")" : r.decision === "revert" ? "overfit (gap " + f3(r.metrics.gap) + ")" : "error") : r.decision === "error" ? "error" : "ok" }),
        h("td", { class: "num", text: secs(r.wall_s) }))))));
  }

  function reviewsCard(night) {
    if (!night.reviews.length) return h("div", { class: "empty", text: "This night has no saved reviews. The loop now saves each round's feedback to nights/<id>/reviews/, so newer nights show it here." });
    return h("div", { class: "feedback" }, night.reviews.map((r) => h("div", { class: "fb" },
      h("b", { text: "After round " + r.round }),
      h("div", { class: "quote", text: r.feedback || "(no feedback)" }),
      r.hypotheses && r.hypotheses.length ? h("ol", null, r.hypotheses.map((x) => h("li", { text: x }))) : null)));
  }

  // ---------- detail + export ----------
  function detailCard(night, v) {
    const e = v.byId.get(state.sel);
    if (!e) return h("section", { class: "card detail" }, h("div", { class: "empty", text: "Select an experiment in the chart or the table." }));
    const ps = v.parentScore(e);
    const parent = v.byId.get(e.parent_id);
    const metricKeys = Object.keys(e.metrics || {}).sort((a, b) => (a === P ? -1 : b === P ? 1 : (a.startsWith("acc_") ? 0 : 1) - (b.startsWith("acc_") ? 0 : 1) || a.localeCompare(b)));
    const diff = D.diffs[e.exp_id];
    const diffPre = h("pre", { class: "diff" });
    if (diff) {
      for (const line of diff.split("\n")) {
        const cls = line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : line.startsWith("@@") ? "hunk" : null;
        diffPre.append(cls ? h("span", { class: cls, text: line }) : document.createTextNode(line + "\n"));
      }
    }
    const isBest = e.exp_id === v.bestId;
    return h("section", { class: "card detail", "aria-live": "polite" },
      h("div", { class: "eyebrow", text: isBest ? "Selected · best of the night" : "Selected experiment" }),
      h("h3", { class: "mono", text: e.exp_id }),
      decisionTag(e.decision),
      h("dl", { class: "kv" },
        h("dt", { text: P }), h("dd", { text: e.decision === "error" ? "–" : f3(v.score(e)) + (ps == null ? "" : "  (" + signed(v.score(e) - ps) + " vs parent)") }),
        h("dt", { text: "Parent" }), h("dd", { class: "mono", text: parent ? shortId(parent.exp_id, night.id) + " · " + f3(ps) : (e.parent_id || "–") }),
        h("dt", { text: "Model" }), h("dd", { text: e.model || "–" }),
        h("dt", { text: "Commit" }), h("dd", { class: "mono", text: e.commit ? e.commit.slice(0, 12) : "–" }),
        h("dt", { text: "Cost · time" }), h("dd", { text: usd(e.coder_usd) + " · " + secs(e.t_code) + " coding · " + secs(e.wall_s) + " total" }),
        h("dt", { text: "Tokens" }), h("dd", { text: e.tokens ? e.tokens.toLocaleString() : "–" })),
      h("div", { class: "eyebrow", style: "color: var(--fg-3)", text: e.round === 1 ? "Coder's approach" : "Reviewer's hypothesis" }),
      h("div", { class: "quote", text: e.hypothesis || "–" }),
      h("div", { class: "eyebrow", style: "color: var(--fg-3); margin-top: 12px", text: "Metrics" }),
      h("div", { class: "metrics" }, metricKeys.map((k) => h("div", null, h("span", { text: k }), h("span", { text: Number.isInteger(e.metrics[k]) ? String(e.metrics[k]) : f3(e.metrics[k]) })))),
      diff ? h("details", null, h("summary", { text: "Diff vs parent" }), diffPre) : h("div", { class: "muted", text: "No diff available." }));
  }

  const q = (x) => (/^[A-Za-z0-9_./:@=-]+$/.test(x) ? x : "'" + x.replace(/'/g, "'\\''") + "'");
  function cliCommand(expId) {
    const f = state.exportForm;
    const parts = ["npm", "run", "export", "--", "--results", q(D.resultsPath), "--exp", q(expId)];
    if (state.exportMode === "dir") {
      parts.push("--to-dir", q(f.dir || "<folder>"));
      if (f.withHistory) parts.push("--with-history");
      if (f.force) parts.push("--force");
    } else {
      parts.push("--to-remote", q(f.url || "<git-url>"));
      if (f.branch) parts.push("--branch", q(f.branch));
    }
    return parts.join(" ");
  }

  function exportCard(night, v) {
    const e = v.byId.get(state.sel);
    const f = state.exportForm;
    const status = h("div", { class: "status" });
    const cli = h("pre", { text: e ? cliCommand(e.exp_id) : "" });
    const refreshCli = () => { if (e) cli.textContent = cliCommand(e.exp_id); };
    const input = (key, attrs) => h("input", Object.assign({ type: "text", value: f[key], spellcheck: "false", autocomplete: "off", oninput: (ev) => { f[key] = ev.target.value; refreshCli(); } }, attrs));
    const check = (key, label) => h("label", { class: "check" }, h("input", { type: "checkbox", checked: f[key], onchange: (ev) => { f[key] = ev.target.checked; refreshCli(); } }), label);
    const fields = state.exportMode === "dir"
      ? [h("div", { class: "field" }, h("label", { for: "cc-dir", text: "Folder" }), input("dir", { id: "cc-dir", placeholder: "/path/to/new-folder" })),
         check("withHistory", "Include git history (branch codeclimb/<exp>)"), check("force", "Overwrite files in a non-empty folder")]
      : [h("div", { class: "field" }, h("label", { for: "cc-url", text: "Remote URL or repo path" }), input("url", { id: "cc-url", placeholder: "git@github.com:you/repo.git" })),
         h("div", { class: "field" }, h("label", { for: "cc-branch", text: "Branch" }), input("branch", { id: "cc-branch", placeholder: e ? "codeclimb/" + e.exp_id : "codeclimb/<exp>" })),
         h("div", { class: "muted", style: "margin-top: 8px", text: "Pushes the experiment's lineage (starter → kept commits → this one) to a branch. Never force-pushes." })];

    async function doExport(btn) {
      if (!e) return;
      const body = state.exportMode === "dir"
        ? { exp_id: e.exp_id, kind: "dir", path: f.dir, with_history: f.withHistory, force: f.force }
        : { exp_id: e.exp_id, kind: "remote", url: f.url, branch: f.branch };
      btn.disabled = true;
      status.className = "status on ok";
      status.textContent = "Exporting " + e.exp_id + "…";
      try {
        const res = await fetch("/api/export", { method: "POST", headers: { "content-type": "application/json", "x-codeclimb-token": boot.server.token }, body: JSON.stringify(body) });
        const out = await res.json().catch(() => ({ error: "bad response (" + res.status + ")" }));
        if (!res.ok || out.error) throw new Error(out.error || "export failed (" + res.status + ")");
        status.className = "status on ok";
        status.textContent = "Exported " + out.expId + " (" + out.sha.slice(0, 7) + ") → " + out.destination + (out.branch ? " · branch " + out.branch : "") + "\n" + out.log;
      } catch (err) {
        status.className = "status on err";
        status.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    }
    async function copyCli(btn) {
      try {
        await navigator.clipboard.writeText(cli.textContent);
        btn.lastChild.textContent = "Copied";
        setTimeout(() => (btn.lastChild.textContent = "Copy Command"), 1500);
      } catch {
        status.className = "status on err";
        status.textContent = "Clipboard blocked: copy the command above by hand.";
      }
    }
    const served = !!boot.server;
    const primary = served
      ? h("button", { class: "btn btn-primary", disabled: !e, onclick: (ev) => doExport(ev.currentTarget) }, icon("download"), h("span", { text: "Export Solution" }))
      : h("button", { class: "btn btn-primary", disabled: !e, onclick: (ev) => copyCli(ev.currentTarget) }, icon("copy"), h("span", { text: "Copy Command" }));
    return h("section", { class: "card export" },
      h("div", { class: "card-head" }, h("h2", { text: "Export" }), h("span", { class: "sub mono", text: e ? shortId(e.exp_id, night.id) : "nothing selected" })),
      h("div", { class: "seg", role: "group", "aria-label": "export destination" },
        h("button", { "aria-pressed": String(state.exportMode === "dir"), onclick: () => { state.exportMode = "dir"; renderSide(); } }, "Local Folder"),
        h("button", { "aria-pressed": String(state.exportMode === "remote"), onclick: () => { state.exportMode = "remote"; renderSide(); } }, "Git Remote")),
      fields,
      h("div", { class: "actions" }, primary),
      status,
      h("div", { class: "cli" },
        h("div", { class: "muted", text: served ? "Same export from a terminal:" : "This page was opened from disk, so it can't run git. Run this, or open the page with `npm run report -- --serve` to export from here:" }),
        cli));
  }

  // ---------- page ----------
  const app = document.getElementById("app");
  let sideEl = null;

  function select(expId) {
    if (!expId) return;
    state.sel = expId;
    render();
  }

  function renderSide() {
    const night = nights.find((n) => n.id === state.night);
    const v = derive(night);
    const fresh = h("aside", { class: "side" }, detailCard(night, v), exportCard(night, v));
    sideEl.replaceWith(fresh);
    sideEl = fresh;
  }

  function nightsTable() {
    if (nights.length < 2) return null;
    const rows = nights.map((n) => {
      const v = derive(n);
      return h("tr", { class: "exp" + (n.id === state.night ? " selected" : ""), tabindex: "0", onclick: () => switchNight(n.id), onkeydown: (ev) => { if (ev.key === "Enter") switchNight(n.id); } },
        h("td", { class: "mono", text: n.id }),
        h("td", { text: n.done ? n.done.stop_reason : "running" }),
        h("td", { class: "num", text: String(v.rounds) }),
        h("td", { class: "num", text: v.keptRounds + " / " + v.rounds }),
        h("td", { class: "num", text: f3(v.cur ? v.score(v.cur) : null) }),
        h("td", { class: "num", text: f3(v.lastVal ? v.score(v.lastVal) : null) }),
        h("td", { class: "num", text: f3(v.lastTest ? v.score(v.lastTest) : null) }),
        h("td", { class: "num", text: v.threshold != null ? f3(v.threshold) : "–" }),
        h("td", { class: "num", text: usd(n.spend_usd) }),
        h("td", { class: "num", text: secs(v.durS) }));
    });
    return h("section", { class: "card" },
      h("div", { class: "card-head" }, h("h2", { text: "All Nights" }), h("span", { class: "sub", text: nights.length + " nights in " + D.title + ". Pick one to explore." })),
      h("div", { class: "table-wrap" }, h("table", null,
        h("thead", null, h("tr", null, ["Night", "Stop reason"].map((t) => h("th", { text: t })), ["Rounds", "Kept in", "Kept " + P, "Validation", "Test", "Threshold", "Spend", "Wall time"].map((t) => h("th", { class: "num", text: t })))),
        h("tbody", null, rows))));
  }

  function switchNight(id) {
    state.night = id;
    state.sel = null;
    store.set("cc-night", id);
    render();
  }

  function render() {
    hideTip();
    const night = nights.find((n) => n.id === state.night);
    const header = h("header", { class: "top" }, h("div", { class: "top-inner" },
      h("img", { class: "logo logo-light", src: boot.logos.onLight, alt: "Decoding AI" }),
      h("img", { class: "logo logo-dark", src: boot.logos.onDark, alt: "Decoding AI" }),
      h("div", { class: "top-title" }, h("span", { class: "eyebrow", text: "CodeClimb Report" }), h("strong", { text: D.title })),
      h("div", { class: "spacer" }),
      nights.length ? h("div", { class: "seg", role: "group", "aria-label": "night" }, nights.map((n) => h("button", { "aria-pressed": String(n.id === state.night), onclick: () => switchNight(n.id) }, n.id))) : null,
      h("button", { class: "icon-btn", "aria-label": isDark() ? "Switch to light theme" : "Switch to dark theme", title: "Theme", onclick: () => { store.set("cc-theme", isDark() ? "light" : "dark"); applyTheme(); render(); } }, icon(isDark() ? "sun" : "moon"))));
    if (!night) {
      app.replaceChildren(header, h("main", null, h("div", { class: "empty", text: "No experiments in " + D.resultsPath + " yet." })));
      return;
    }
    const v = derive(night);
    if (!state.sel || !v.byId.has(state.sel)) state.sel = v.bestId;
    const stop = night.done ? night.done.stop_reason : "running";
    const started = night.startedAt ? new Date(night.startedAt).toLocaleString() : "–";
    const hero = h("div", { class: "hero" },
      h("div", null,
        h("div", { class: "eyebrow", text: "Night" }),
        h("h1", { class: "mono", text: night.id }),
        h("p", { text: "Started " + started + (night.config ? " · " + night.config.models.length + " branches × up to " + night.config.max_rounds + " rounds · reviewer " + night.config.reviewer_model : "") })),
      h("span", { class: "badge" + (stop === "thresholds" ? " hot" : "") }, icon("flag"), stop === "running" ? "running" : "stopped: " + stop));
    const keptExp = v.cur;
    const kpis = h("div", { class: "kpis" },
      h("div", { class: "kpi lead" }, h("div", { class: "label", text: "Kept " + P }), h("div", { class: "value", text: f3(keptExp ? v.score(keptExp) : null) }), h("div", { class: "note mono", text: keptExp ? shortId(keptExp.exp_id, night.id) + (v.threshold != null ? " · threshold " + f3(v.threshold) : "") : "nothing kept" })),
      h("div", { class: "kpi" }, h("div", { class: "label", text: "Validation" }), h("div", { class: "value", text: f3(v.lastVal ? v.score(v.lastVal) : null) }), h("div", { class: "note", text: v.lastVal ? (v.lastVal.decision === "keep" ? "no overfit · gap " : "overfit · gap ") + f3(v.lastVal.metrics.gap) : "not run" })),
      h("div", { class: "kpi" }, h("div", { class: "label", text: "Test" }), h("div", { class: "value", text: f3(v.lastTest ? v.score(v.lastTest) : null) }), h("div", { class: "note", text: v.lastTest ? "scored once, at the end" : "not run yet" })),
      h("div", { class: "kpi" }, h("div", { class: "label", text: "Rounds" }), h("div", { class: "value", text: String(v.rounds) }), h("div", { class: "note", text: "kept a commit in " + v.keptRounds })),
      h("div", { class: "kpi" }, h("div", { class: "label", text: "Experiments" }), h("div", { class: "value", text: String(v.exps.length) }), h("div", { class: "note", text: v.counts.keep + " kept · " + v.counts.revert + " reverted · " + v.counts.error + " errors" })),
      h("div", { class: "kpi" }, h("div", { class: "label", text: "Spend" }), h("div", { class: "value", text: usd(night.spend_usd) }), h("div", { class: "note", text: "wall time " + secs(v.durS) })));

    const convBody = state.convTable ? convergenceTable(night, v) : convergenceChart(night, v);
    const heatBody = state.heatTable ? heatTable(night, v) : heatmap(night, v);
    const toggle = (key, on) => h("button", { class: "link-btn", "aria-pressed": String(on), onclick: () => { state[key] = !state[key]; render(); } }, on ? "Chart" : "Table");
    const left = h("div", { style: "display:grid; gap: var(--space-5); min-width: 0" },
      h("section", { class: "card" },
        h("div", { class: "card-head" }, h("h2", { text: "How the Night Converged" }), h("span", { class: "sub", text: "Every experiment's " + P + " on the optimization folds. The red line is the kept commit." }), h("div", { class: "tools" }, toggle("convTable", state.convTable))),
        convBody),
      h("section", { class: "card" },
        h("div", { class: "card-head" }, h("h2", { text: "Metric Families" }), h("span", { class: "sub", text: "Share of items wrong per input family: darker means more left to fix." }),
          h("div", { class: "tools" },
            h("div", { class: "seg" },
              h("button", { "aria-pressed": String(state.heat === "lineage"), onclick: () => { state.heat = "lineage"; render(); } }, "Kept lineage"),
              h("button", { "aria-pressed": String(state.heat === "all"), onclick: () => { state.heat = "all"; render(); } }, "All experiments")),
            toggle("heatTable", state.heatTable))),
        heatBody),
      h("section", { class: "card" },
        h("div", { class: "card-head" }, h("h2", { text: "Experiments" }), h("span", { class: "sub", text: "Click a row to inspect it and pick it for export." })),
        experimentsTable(night, v)),
      evalsTable(night, v) ? h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { text: "Extra Evaluations" }), h("span", { class: "sub", text: "Re-scores, noise floor, validation on the held-out fold, and the one test score." })), evalsTable(night, v)) : null,
      h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { text: "Reviewer Feedback" }), h("span", { class: "sub", text: night.config ? night.config.reviewer_model : "" })), reviewsCard(night)));
    sideEl = h("aside", { class: "side" }, detailCard(night, v), exportCard(night, v));
    const main = h("main", null, nightsTable(), hero, kpis, h("div", { class: "grid-2" }, left, sideEl));
    const footer = h("footer", { text: "Generated " + new Date(D.generatedAt).toLocaleString() + " from " + D.resultsPath + (boot.server ? " · served locally" : " · reload after the next round to refresh") });
    app.replaceChildren(header, main, footer);
  }

  render();
})();
