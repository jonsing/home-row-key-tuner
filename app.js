(function () {
  "use strict";

  const Core = window.TunerCore;
  const STORAGE_KEY = "hrm-tuner-sessions";
  const SETTINGS_KEY = "hrm-tuner-settings";
  const CURRENT_SETTINGS = { holdTimeout: 130, overlapThreshold: 80, minHoldTime: 80, minPriorInterval: 75 };
  const PARAM_LABELS = {
    holdTimeout: "Hold timeout",
    overlapThreshold: "Overlap threshold",
    minHoldTime: "Minimum hold time",
    minPriorInterval: "Minimum prior interval",
  };
  const REASONS = {
    "hold-timeout": "Held longer than the hold timeout",
    "other-key-released": "Next key was released while this one was still held, after the minimum hold time",
    overlap: "Released first, but the next key was released inside the overlap window",
    rollover: "Released while the next key was down, overlap too small to count as Shift",
    "released-alone": "Released before any other key was pressed",
    "prior-interval": "Pressed too soon after the previous letter (minimum prior interval)",
    "queue-full": "Event queue full",
  };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) node.append(c);
    return node;
  };
  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // ---------------------------------------------------------------- storage

  let sessions = loadSessions();
  const selected = new Set(sessions.map((s) => s.id));

  function loadSessions() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveSessions() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }

  // ---------------------------------------------------------------- tabs

  document.querySelectorAll("nav button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("active", x === b));
      for (const tab of ["capture", "analyze", "data"]) $("#tab-" + tab).classList.toggle("hidden", tab !== b.dataset.tab);
      if (b.dataset.tab === "analyze") renderAnalyzeStatic();
    }),
  );

  // ---------------------------------------------------------------- capture

  const corpusSelect = $("#corpus");
  for (const [id, c] of Object.entries(window.CORPUS)) corpusSelect.append(el("option", { value: id }, c.name));
  corpusSelect.append(el("option", { value: "custom" }, "Custom text"));
  corpusSelect.addEventListener("change", () => $("#custom-text").classList.toggle("hidden", corpusSelect.value !== "custom"));

  const typing = $("#typing");
  let cap = null;

  function buildTarget() {
    const length = Number($("#length").value);
    if (corpusSelect.value === "custom") {
      const text = $("#custom-text").value.replace(/\s+/g, " ").replace(/[^\p{L}\p{N} .,;'-]/gu, "").trim();
      return text.slice(0, Math.max(length, 2000));
    }
    const pool = [...window.CORPUS[corpusSelect.value].sentences];
    const parts = [];
    let total = 0;
    while (total < length) {
      if (!pool.length) pool.push(...window.CORPUS[corpusSelect.value].sentences);
      const s = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      parts.push(s);
      total += s.length + 1;
    }
    return parts.join(" ");
  }

  function startCapture() {
    const target = buildTarget();
    if (!target) return;
    cap = {
      target,
      textName: corpusSelect.value,
      pos: 0,
      t0: null,
      events: [],
      labels: {},
      positions: {},
      held: new Map(),
      shiftIntent: null,
      typos: 0,
      sawShift: false,
    };
    typing.classList.remove("idle");
    typing.textContent = "";
    cap.spans = [...target].map((ch) => {
      const s = el("span", {}, ch);
      typing.append(s);
      return s;
    });
    cap.spans[0].classList.add("cur");
    $("#start").classList.add("hidden");
    $("#finish").classList.remove("hidden");
    $("#capture-warn").textContent = "";
    typing.focus();
    updateCaptureStatus();
  }

  function finishCapture() {
    if (!cap) return;
    const c = cap;
    cap = null;
    $("#start").classList.remove("hidden");
    $("#finish").classList.add("hidden");
    typing.classList.add("idle");
    const labelled = Object.values(c.labels).filter((l) => l !== "unknown").length;
    if (c.events.length < 20 || labelled === 0) {
      typing.textContent = "Session too short, not saved.";
      return;
    }
    const session = {
      id: Date.now().toString(36),
      createdAt: new Date().toISOString(),
      textName: c.textName,
      target: c.target.slice(0, c.pos),
      events: c.events,
      labels: c.labels,
      positions: c.positions,
      typos: c.typos,
    };
    sessions.push(session);
    selected.add(session.id);
    saveSessions();
    typing.textContent = `Saved: ${c.pos} characters, ${countLabels(session, "tap")} a/; taps, ${countLabels(session, "hold")} Shift holds. Start another session or go to Analyze.`;
  }

  // YYYY-MM-DD HH:MM:SS in local time, 24 hour clock.
  function formatDate(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function countLabels(session, label) {
    return Object.values(session.labels).filter((l) => l === label).length;
  }

  function updateCaptureStatus() {
    if (!cap) return;
    const taps = Object.values(cap.labels).filter((l) => l === "tap").length;
    const holds = Object.values(cap.labels).filter((l) => l === "hold").length;
    $("#capture-status").textContent = `${cap.pos}/${cap.target.length} · a/; taps ${taps} · Shift holds ${holds} · typos ${cap.typos}`;
  }

  function advance() {
    const span = cap.spans[cap.pos];
    span.classList.remove("cur", "err");
    span.classList.add("done");
    cap.pos++;
    if (cap.pos >= cap.target.length) {
      finishCapture();
      return;
    }
    cap.spans[cap.pos].classList.add("cur");
    const r = cap.spans[cap.pos].getBoundingClientRect();
    if (r.bottom > window.innerHeight - 20) cap.spans[cap.pos].scrollIntoView({ block: "center" });
  }

  function typo() {
    cap.typos++;
    cap.spans[cap.pos].classList.add("err");
  }

  function onKeyDown(e) {
    if (!cap || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    if (e.repeat) return;
    if (e.key === "Escape") {
      finishCapture();
      return;
    }
    if (cap.held.has(e.code)) return;
    if (cap.t0 === null) cap.t0 = e.timeStamp;
    const idx = cap.events.length;
    cap.events.push({ t: e.timeStamp - cap.t0, code: e.code, key: e.key, down: true });
    cap.held.set(e.code, idx);

    if (e.code.startsWith("Shift") && !cap.sawShift) {
      cap.sawShift = true;
      $("#capture-warn").textContent =
        "A Shift key press arrived. If a or ; still have home-row Shift on this layer, the recording is not raw. Hold a or ; for capitals instead of a real Shift key.";
    }

    labelPress(e, idx);
    updateCaptureStatus();
  }

  // Decide what a press of "a" or ";" was meant to be, from the target text.
  function labelPress(e, idx) {
    const expected = cap.target[cap.pos];
    const key = (e.key || "").toLowerCase();
    const isQukey = Core.QUKEY_CODES.has(e.code);
    const isUpper = expected !== expected.toLowerCase();
    const physicalShift = [...cap.held.keys()].some((c) => c.startsWith("Shift"));

    if (isQukey) cap.positions[idx] = cap.pos;

    if (isUpper) {
      if (isQukey && key !== expected.toLowerCase() && cap.shiftIntent === null) {
        cap.labels[idx] = "hold";
        cap.shiftIntent = e.code;
        return;
      }
      if (key === expected.toLowerCase()) {
        if (isQukey) cap.labels[idx] = cap.shiftIntent ? "tap" : "unknown";
        if (!cap.shiftIntent && !physicalShift) cap.spans[cap.pos].classList.add("missedcap");
        advance();
        return;
      }
      if (isQukey) cap.labels[idx] = "unknown";
      typo();
      return;
    }

    if (key === expected) {
      if (isQukey) cap.labels[idx] = "tap";
      advance();
      return;
    }
    if (isQukey) cap.labels[idx] = "unknown";
    if (e.key !== "Backspace") typo();
  }

  function onKeyUp(e) {
    if (!cap) return;
    e.preventDefault();
    if (!cap.held.has(e.code)) return;
    cap.held.delete(e.code);
    cap.events.push({ t: e.timeStamp - cap.t0, code: e.code, key: e.key, down: false });
    if (cap.shiftIntent === e.code) cap.shiftIntent = null;
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => {
    if (cap) {
      $("#capture-warn").textContent = "The window lost focus, key releases may be missing. Finish and start a new session if this was mid-word.";
    }
  });
  // Setup check: a plain key auto-repeats when held, a home-row Superkey
  // sends Shift instead (left Shift for a, right Shift for ;).
  const setStatus = (id, cls, text) => {
    const node = $(id);
    node.className = "check-status " + cls;
    node.textContent = text;
  };
  $("#check-field").addEventListener("keydown", (e) => {
    if (e.code === "KeyA" && e.repeat) setStatus("#check-a", "ok", "a is a plain key");
    if (e.code === "Semicolon" && e.repeat) setStatus("#check-semicolon", "ok", "; is a plain key");
    if (e.code === "ShiftLeft" && !e.repeat) setStatus("#check-a", "bad", "a sent Left Shift, still a Superkey on this layer");
    if (e.code === "ShiftRight" && !e.repeat) setStatus("#check-semicolon", "bad", "; sent Right Shift, still a Superkey on this layer");
  });
  if (sessions.length) $("#setup-help").open = false;

  $("#start").addEventListener("click", startCapture);
  $("#finish").addEventListener("click", finishCapture);

  // ---------------------------------------------------------------- analyze

  function readParams() {
    const p = {};
    for (const k of Core.PARAM_KEYS) {
      const [lo, hi] = Core.LIMITS[k];
      const v = Math.round(Number($("#p-" + k).value));
      p[k] = Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : CURRENT_SETTINGS[k];
      $("#p-" + k).value = p[k];
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(p));
    return p;
  }

  function writeParams(p) {
    for (const k of Core.PARAM_KEYS) $("#p-" + k).value = p[k];
  }

  function readWeights() {
    return { falseHold: Number($("#w-falseHold").value) || 0, falseTap: Number($("#w-falseTap").value) || 0 };
  }

  writeParams(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null") || CURRENT_SETTINGS);

  function preparedSelection() {
    return sessions.filter((s) => selected.has(s.id)).map(Core.prepare);
  }

  function renderAnalyzeStatic() {
    renderSessionList();
    renderStats();
  }

  function renderSessionList() {
    const box = $("#session-list");
    box.textContent = "";
    if (!sessions.length) {
      box.append(el("p", {}, "No sessions yet. Record one on the Capture tab."));
      return;
    }
    const table = el("table");
    table.innerHTML = `<tr><th></th><th>Recorded</th><th>Text</th><th class="num">Chars</th><th class="num">a/; taps</th><th class="num">Shift holds</th><th class="num">Typos</th><th></th></tr>`;
    for (const s of sessions) {
      const cb = el("input", { type: "checkbox" });
      cb.checked = selected.has(s.id);
      cb.addEventListener("change", () => {
        cb.checked ? selected.add(s.id) : selected.delete(s.id);
        renderStats();
      });
      const del = el("button", { class: "secondary" }, "Delete");
      del.addEventListener("click", () => {
        if (!confirm("Delete this session?")) return;
        sessions = sessions.filter((x) => x.id !== s.id);
        selected.delete(s.id);
        saveSessions();
        renderAnalyzeStatic();
      });
      const name = window.CORPUS[s.textName] ? window.CORPUS[s.textName].name : s.textName;
      const tr = el("tr", {},
        el("td", {}, cb),
        el("td", { class: "mono" }, formatDate(s.createdAt)),
        el("td", {}, name),
        el("td", { class: "num" }, String(s.target.length)),
        el("td", { class: "num" }, String(countLabels(s, "tap"))),
        el("td", { class: "num" }, String(countLabels(s, "hold"))),
        el("td", { class: "num" }, String(s.typos || 0)),
        el("td", {}, del),
      );
      table.append(tr);
    }
    box.append(table);
  }

  function requireData() {
    const prepared = preparedSelection();
    if (!prepared.length) {
      alert("Select at least one recorded session first.");
      return null;
    }
    return prepared;
  }

  function runSimulation(ranking) {
    const prepared = requireData();
    if (!prepared) return;
    const params = readParams();
    const result = Core.evaluate(prepared, params, { keepMisses: true, recordOutput: true });
    $("#results").classList.remove("hidden");
    $("#result-params").textContent = Core.PARAM_KEYS.map((k) => params[k]).join(" / ");
    renderTiles(result);
    renderCharts(prepared, params);
    renderMisses(result);
    renderOutput(result);
    $("#ranking-card").classList.toggle("hidden", !ranking);
  }

  function renderTiles(r) {
    const tile = (label, value, sub, color) =>
      el("div", { class: "tile" },
        el("div", { class: "label" }, ...(color ? [el("i", { class: "swatch", style: `background:${color}` })] : []), label),
        el("div", { class: "value" }, value),
        el("div", { class: "sub" }, sub),
      );
    const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + "%" : "-");
    const box = $("#tiles");
    box.textContent = "";
    box.append(
      tile("False Shift", String(r.falseHolds), `${pct(r.falseHolds, r.taps)} of ${r.taps} a/; taps`, "var(--series-false-hold)"),
      tile("Missed Shift", String(r.falseTaps), `${pct(r.falseTaps, r.holds)} of ${r.holds} Shift holds`, "var(--series-false-tap)"),
    );
  }

  // ---------------------------------------------------------------- charts

  function renderCharts(prepared, params) {
    const box = $("#charts");
    box.textContent = "";
    for (const key of Core.PARAM_KEYS) {
      const data = Core.sweep(prepared, params, key);
      box.append(lineChart(key, data, params[key]));
    }
  }

  function lineChart(key, data, current) {
    const W = 340, H = 190, m = { l: 36, r: 64, t: 10, b: 30 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const xs = data.map((d) => d.value);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const maxY = Math.max(1, ...data.map((d) => Math.max(d.falseHolds, d.falseTaps)));
    const yTicks = niceTicks(maxY);
    const yMax = yTicks[yTicks.length - 1];
    const sx = (v) => m.l + ((v - x0) / (x1 - x0)) * iw;
    const sy = (v) => m.t + ih - (v / yMax) * ih;
    const series = [
      { field: "falseHolds", name: "false ⇧", color: "var(--series-false-hold)" },
      { field: "falseTaps", name: "missed ⇧", color: "var(--series-false-tap)" },
    ];

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${PARAM_LABELS[key]} sweep">`;
    for (const t of yTicks) {
      svg += `<line x1="${m.l}" x2="${m.l + iw}" y1="${sy(t)}" y2="${sy(t)}" stroke="var(--grid)" stroke-width="1"/>`;
      svg += `<text x="${m.l - 6}" y="${sy(t) + 4}" fill="var(--text-muted)" font-size="10" text-anchor="end">${t}</text>`;
    }
    for (const t of niceTicks(x1, x0, 5)) {
      if (t < x0 || t > x1) continue;
      svg += `<text x="${sx(t)}" y="${H - m.b + 16}" fill="var(--text-muted)" font-size="10" text-anchor="middle">${t}</text>`;
    }
    svg += `<line x1="${sx(current)}" x2="${sx(current)}" y1="${m.t}" y2="${m.t + ih}" stroke="var(--text-secondary)" stroke-dasharray="3 3" stroke-width="1"/>`;

    const ends = [];
    for (const s of series) {
      const path = data.map((d, i) => `${i ? "L" : "M"}${sx(d.value).toFixed(1)},${sy(d[s.field]).toFixed(1)}`).join("");
      svg += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
      ends.push({ y: sy(data[data.length - 1][s.field]), s });
    }
    // Direct labels at the line ends, nudged apart if they collide.
    ends.sort((a, b) => a.y - b.y);
    if (ends.length === 2 && ends[1].y - ends[0].y < 12) {
      const mid = (ends[0].y + ends[1].y) / 2;
      ends[0].y = mid - 6;
      ends[1].y = mid + 6;
    }
    for (const e of ends) {
      svg += `<text x="${m.l + iw + 6}" y="${e.y + 4}" fill="var(--text-secondary)" font-size="10">${e.s.name}</text>`;
    }
    svg += `<g class="hover" visibility="hidden"><line class="hx" y1="${m.t}" y2="${m.t + ih}" stroke="var(--text-muted)" stroke-width="1"/>`;
    for (const s of series) svg += `<circle class="hd-${s.field}" r="4" fill="${s.color}" stroke="var(--surface-1)" stroke-width="2"/>`;
    svg += `</g><rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" style="cursor:pointer"/></svg>`;

    const wrap = el("div", { class: "chart" });
    wrap.innerHTML = `<div class="title">${PARAM_LABELS[key]}</div>${svg}`;
    const tip = el("div", { class: "tooltip hidden" });
    wrap.append(tip);
    const svgEl = wrap.querySelector("svg");
    const hover = svgEl.querySelector(".hover");
    const nearest = (evt) => {
      const pt = svgEl.createSVGPoint();
      pt.x = evt.clientX;
      pt.y = evt.clientY;
      const p = pt.matrixTransform(svgEl.getScreenCTM().inverse());
      let best = data[0];
      for (const d of data) if (Math.abs(sx(d.value) - p.x) < Math.abs(sx(best.value) - p.x)) best = d;
      return best;
    };
    const hit = svgEl.querySelector(".hit");
    hit.addEventListener("mousemove", (evt) => {
      const d = nearest(evt);
      hover.setAttribute("visibility", "visible");
      const hx = hover.querySelector(".hx");
      hx.setAttribute("x1", sx(d.value));
      hx.setAttribute("x2", sx(d.value));
      for (const s of series) {
        const c = hover.querySelector(".hd-" + s.field);
        c.setAttribute("cx", sx(d.value));
        c.setAttribute("cy", sy(d[s.field]));
      }
      tip.classList.remove("hidden");
      tip.innerHTML = `<strong>${PARAM_LABELS[key]} ${d.value}</strong><br>False Shift: ${d.falseHolds}<br>Missed Shift: ${d.falseTaps}<br><span style="color:var(--text-muted)">click to test this value</span>`;
      const rect = wrap.getBoundingClientRect();
      const left = evt.clientX - rect.left + 12;
      tip.style.left = Math.min(left, rect.width - tip.offsetWidth - 4) + "px";
      tip.style.top = evt.clientY - rect.top + 12 + "px";
    });
    hit.addEventListener("mouseleave", () => {
      hover.setAttribute("visibility", "hidden");
      tip.classList.add("hidden");
    });
    hit.addEventListener("click", (evt) => {
      $("#p-" + key).value = nearest(evt).value;
      runSimulation(!$("#ranking-card").classList.contains("hidden"));
    });
    return wrap;
  }

  function niceTicks(max, min = 0, count = 4) {
    const span = max - min || 1;
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((f) => f * mag).find((s) => s >= raw);
    const out = [];
    for (let v = Math.ceil(min / step) * step; v < max + step; v += step) {
      out.push(Math.round(v * 100) / 100);
      if (v >= max) break;
    }
    return out;
  }

  // ---------------------------------------------------------------- misses

  function renderMisses(result) {
    const box = $("#misses");
    box.textContent = "";
    if (!result.misses.length) {
      box.append(el("p", {}, "No errors in the selected sessions with these settings."));
      return;
    }
    const byReason = {};
    for (const m of result.misses) {
      const k = `${m.intent}|${m.reason}`;
      byReason[k] = (byReason[k] || 0) + 1;
    }
    const summary = el("table");
    summary.innerHTML = `<tr><th>Error</th><th>Firmware rule that decided it</th><th class="num">Count</th></tr>`;
    for (const [k, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
      const [intent, reason] = k.split("|");
      const swatch = intent === "tap" ? "var(--series-false-hold)" : "var(--series-false-tap)";
      summary.insertAdjacentHTML("beforeend",
        `<tr><td><i class="swatch" style="background:${swatch}"></i> ${intent === "tap" ? "False Shift" : "Missed Shift"}</td><td>${REASONS[reason] || reason}</td><td class="num">${n}</td></tr>`);
    }
    box.append(summary);

    box.append(el("h3", {}, "Individual cases (first 60)"));
    const table = el("table");
    table.innerHTML = `<tr><th>Text</th><th>Wanted</th><th>Rule</th><th>Timeline (ms from press)</th></tr>`;
    for (const m of result.misses.slice(0, 60)) {
      const p = m.prepared;
      const pos = p.session.positions ? p.session.positions[m.id] : undefined;
      const ctx = pos === undefined ? "" : contextHtml(p.session.target, pos);
      table.insertAdjacentHTML("beforeend",
        `<tr><td class="mono">${ctx}</td><td>${m.intent === "tap" ? "letter" : "Shift"}</td><td>${m.reason}</td><td class="mono timeline">${timelineHtml(p.events, m.id)}</td></tr>`);
    }
    box.append(table);
  }

  function contextHtml(target, pos) {
    const a = Math.max(0, pos - 10);
    const before = escapeHtml(target.slice(a, pos));
    const ch = escapeHtml(target[pos] || "");
    const after = escapeHtml(target.slice(pos + 1, pos + 10));
    return `${before}<strong style="color:var(--text-primary);text-decoration:underline">${ch}</strong>${after}`.replace(/ /g, "&nbsp;");
  }

  const KEY_NAMES = { KeyA: "a", Semicolon: ";", Space: "␣", Comma: ",", Period: ".", Quote: "'", Backspace: "⌫" };
  const keyName = (code) => KEY_NAMES[code] || (code.startsWith("Key") ? code.slice(3).toLowerCase() : code);

  function timelineHtml(events, id) {
    const start = events[id];
    let prev = null;
    for (let j = id - 1; j >= 0; j--) {
      if (events[j].down && window.QukeysSim.isPrintableCode(events[j].code)) {
        prev = events[j];
        break;
      }
    }
    const parts = [];
    if (prev && start.t - prev.t < 400) parts.push(`<span>prev ${keyName(prev.code)} −${start.t - prev.t}</span>`);
    // Show the press, every key pressed while it was held, and their releases.
    const open = new Set();
    let released = false;
    for (let j = id; j < events.length && parts.length < 10; j++) {
      const e = events[j];
      if (e.down) {
        if (released) continue;
        open.add(e.code);
      } else {
        if (!open.has(e.code)) continue;
        open.delete(e.code);
        if (e.code === start.code) released = true;
      }
      const q = e.code === start.code ? ' class="q"' : "";
      parts.push(`<span${q}>${keyName(e.code)}${e.down ? "↓" : "↑"}${e.t - start.t}</span>`);
      if (released && open.size === 0) break;
    }
    return parts.join("");
  }

  // ---------------------------------------------------------------- output

  function renderOutput(result) {
    const box = $("#output");
    const last = result.perSession[result.perSession.length - 1];
    if (!last) {
      box.textContent = "";
      return;
    }
    const { prepared, res } = last;
    const charOf = new Map();
    for (const e of prepared.session.events) if (e.down && e.key && e.key.length === 1) charOf.set(e.code, e.key.toLowerCase());
    const shiftSources = new Map();
    let physicalShift = 0;
    let html = "";
    for (const o of res.output) {
      if (o.key.type === "shift") {
        if (o.down) {
          shiftSources.set(o.code, o.id);
          if (prepared.labels.get(o.id) === "tap") html += '<span class="shiftmark">⇧</span>';
        } else {
          shiftSources.delete(o.code);
        }
        continue;
      }
      if (o.code.startsWith("Shift")) {
        physicalShift += o.down ? 1 : -1;
        continue;
      }
      if (!o.down || o.key.type !== "char") continue;
      const ch = charOf.get(o.code);
      if (!ch) continue;
      const shifted = shiftSources.size > 0 || physicalShift > 0;
      let cls = "";
      if (shifted && [...shiftSources.values()].some((id) => prepared.labels.get(id) === "tap")) cls = "fh";
      if (prepared.labels.get(o.id) === "hold") cls = "ft";
      const out = escapeHtml(shifted ? ch.toUpperCase() : ch);
      html += cls ? `<span class="${cls}">${out}</span>` : out;
    }
    box.innerHTML = html;
  }

  // ---------------------------------------------------------------- stats

  function renderStats() {
    const box = $("#stats");
    const prepared = preparedSelection();
    if (!prepared.length) {
      box.innerHTML = "<p>No sessions selected.</p>";
      return;
    }
    const s = Core.timingStats(prepared);
    const cols = [5, 25, 50, 75, 95];
    const rows = [
      ["a/; tap: time held", s.tapDwell, "Taps held longer than the hold timeout become Shift."],
      ["a/; tap rolled into the next key: overlap, % of that key's press", s.tapRollOverlap, "Above the overlap threshold, a tap is read as Shift."],
      ["a/; tap where the next key was released first: time from press until that release", s.tapNextReleasedFirst, "Above the minimum hold time, these become Shift."],
      ["a/; tap: time since previous letter", s.tapPriorGap, "Below the minimum prior interval, a press is always a letter."],
      ["Shift hold: time since previous letter", s.holdPriorGap, "Below the minimum prior interval, the Shift is lost."],
      ["Shift hold: press until the letter is pressed", s.holdToLetter, ""],
      ["Shift hold: Shift released after the letter (negative = let go of Shift first)", s.holdReleaseAfterLetter, ""],
    ];
    let html = `<p>${s.tapRolls} of ${s.taps} a/; taps (${s.taps ? Math.round((100 * s.tapRolls) / s.taps) : 0}%) rolled into the next key before being released.</p>`;
    html += `<table><tr><th>Measure</th>${cols.map((c) => `<th class="num">p${c}</th>`).join("")}<th class="num">n</th><th>Why it matters</th></tr>`;
    for (const [label, values, why] of rows) {
      html += `<tr><td>${label}</td>${cols.map((c) => `<td class="num">${values.length ? Math.round(Core.percentile(values, c)) : "-"}</td>`).join("")}<td class="num">${values.length}</td><td style="color:var(--text-muted)">${why}</td></tr>`;
    }
    box.innerHTML = html + "</table>";
  }

  // ---------------------------------------------------------------- search

  $("#simulate").addEventListener("click", () => runSimulation(false));
  $("#reset-current").addEventListener("click", () => {
    writeParams(CURRENT_SETTINGS);
    runSimulation(false);
  });

  $("#search").addEventListener("click", () => {
    const prepared = requireData();
    if (!prepared) return;
    const weights = readWeights();
    const current = readParams();
    const it = Core.search(prepared, weights);
    const bar = $("#progress");
    bar.classList.remove("hidden");
    $("#search").disabled = true;
    const step = () => {
      const t0 = performance.now();
      let r;
      while (performance.now() - t0 < 40) {
        r = it.next();
        if (r.done) break;
        bar.firstElementChild.style.width = Math.round(r.value * 100) + "%";
      }
      if (!r.done) {
        setTimeout(step, 0);
        return;
      }
      bar.classList.add("hidden");
      $("#search").disabled = false;
      renderRanking(r.value, prepared, current);
      writeParams(r.value[0].params);
      runSimulation(true);
    };
    step();
  });

  function renderRanking(ranked, prepared, current) {
    const mine = Core.evaluate(prepared, CURRENT_SETTINGS);
    const table = $("#ranking");
    const header = `<tr><th></th>${Core.PARAM_KEYS.map((k) => `<th class="num">${PARAM_LABELS[k]}</th>`).join("")}<th class="num">False Shift</th><th class="num">Missed Shift</th><th class="num">Neighbour avg cost</th><th></th></tr>`;
    const row = (label, p, fh, ft, nb, cls) =>
      `<tr class="${cls}"><td>${label}</td>${Core.PARAM_KEYS.map((k) => `<td class="num">${p[k]}</td>`).join("")}<td class="num">${fh}</td><td class="num">${ft}</td><td class="num">${nb}</td><td><button class="secondary" data-use='${JSON.stringify(p)}'>Test</button></td></tr>`;
    let html = header + row("Your current settings", CURRENT_SETTINGS, mine.falseHolds, mine.falseTaps, "", "");
    if (Core.PARAM_KEYS.some((k) => current[k] !== CURRENT_SETTINGS[k])) {
      const cur = Core.evaluate(prepared, current);
      html += row("Tested before search", current, cur.falseHolds, cur.falseTaps, "", "");
    }
    ranked.slice(0, 10).forEach((r, i) => {
      html += row(i === 0 ? "Best" : `#${i + 1}`, r.params, r.falseHolds, r.falseTaps, Number.isFinite(r.neighbourCost) ? r.neighbourCost.toFixed(1) : "-", i === 0 ? "best" : "");
    });
    table.innerHTML = html;
    table.querySelectorAll("button[data-use]").forEach((b) =>
      b.addEventListener("click", () => {
        writeParams(JSON.parse(b.dataset.use));
        runSimulation(true);
      }),
    );
  }

  // ---------------------------------------------------------------- data

  $("#export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ version: 1, sessions }, null, 1)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `hrm-tuner-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("#import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const data = JSON.parse(await file.text());
    const known = new Set(sessions.map((s) => s.id));
    let added = 0;
    for (const s of data.sessions || []) {
      if (known.has(s.id)) continue;
      sessions.push(s);
      selected.add(s.id);
      added++;
    }
    saveSessions();
    alert(`Imported ${added} new session(s).`);
    e.target.value = "";
  });

  $("#clear").addEventListener("click", () => {
    if (!confirm("Delete all recorded sessions in this browser?")) return;
    sessions = [];
    selected.clear();
    saveSessions();
  });
})();
