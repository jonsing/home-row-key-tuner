// Analysis shared by the page and the node tests: turning captured sessions
// into simulator input, scoring settings, searching the settings space and
// summarising raw timing.
(function (root) {
  "use strict";

  const Sim = typeof module !== "undefined" && module.exports ? require("./qukeys-sim.js") : root.QukeysSim;

  const QUKEY_CODES = new Set(["KeyA", "Semicolon"]);

  // Slider ranges in Bazecor.
  const LIMITS = {
    holdTimeout: [1, 255],
    overlapThreshold: [0, 100],
    minHoldTime: [1, 254],
    minPriorInterval: [1, 254],
  };
  const PARAM_KEYS = Object.keys(LIMITS);

  function prepare(session) {
    const events = session.events.map((e, id) => ({ id, t: Math.round(e.t), code: e.code, down: e.down }));
    const labels = new Map();
    for (const [id, label] of Object.entries(session.labels)) labels.set(Number(id), label);
    return { session, events, labels };
  }

  function evaluate(prepared, params, options = {}) {
    const total = { taps: 0, holds: 0, falseHolds: 0, falseTaps: 0, misses: [], perSession: [] };
    for (const p of prepared) {
      const res = Sim.simulate(p.events, params, { qukeyCodes: QUKEY_CODES, recordOutput: !!options.recordOutput });
      const s = Sim.score(res.qukeyResults, p.labels);
      total.taps += s.taps;
      total.holds += s.holds;
      total.falseHolds += s.falseHolds;
      total.falseTaps += s.falseTaps;
      if (options.keepMisses) for (const m of s.misses) total.misses.push({ ...m, prepared: p });
      if (options.recordOutput) total.perSession.push({ prepared: p, res });
    }
    return total;
  }

  function cost(result, weights) {
    return weights.falseHold * result.falseHolds + weights.falseTap * result.falseTaps;
  }

  function range(from, to, step) {
    const out = [];
    for (let v = from; v <= to; v += step) out.push(v);
    if (out[out.length - 1] !== to) out.push(to);
    return out;
  }

  const COARSE = {
    holdTimeout: range(110, 255, 20),
    overlapThreshold: range(50, 100, 10),
    minHoldTime: range(30, 210, 20),
    minPriorInterval: range(30, 250, 20),
  };
  const FINE_STEP = { holdTimeout: 5, overlapThreshold: 5, minHoldTime: 5, minPriorInterval: 5 };

  function clampParam(key, v) {
    const [lo, hi] = LIMITS[key];
    return Math.max(lo, Math.min(hi, v));
  }

  function keyOf(p) {
    return PARAM_KEYS.map((k) => p[k]).join(",");
  }

  function cartesian(axes) {
    let combos = [{}];
    for (const k of PARAM_KEYS) {
      const next = [];
      for (const c of combos) for (const v of axes[k]) next.push({ ...c, [k]: v });
      combos = next;
    }
    return combos;
  }

  // Coarse grid, then a fine grid around the best coarse points. Yields
  // progress so the page can stay responsive.
  function* search(prepared, weights, options = {}) {
    const results = new Map();
    const run = (params) => {
      const k = keyOf(params);
      if (!results.has(k)) {
        const r = evaluate(prepared, params);
        results.set(k, { params, falseHolds: r.falseHolds, falseTaps: r.falseTaps, cost: cost(r, weights) });
      }
    };

    const coarse = cartesian(COARSE);
    const fineSeeds = options.seeds || 4;
    const fineSpan = 2;
    const total = coarse.length + fineSeeds * Math.pow(2 * fineSpan + 1, 4);
    let done = 0;
    for (const p of coarse) {
      run(p);
      if (++done % 200 === 0) yield done / total;
    }

    const seeds = rank([...results.values()], results).slice(0, fineSeeds);
    for (const seed of seeds) {
      const axes = {};
      for (const k of PARAM_KEYS) {
        axes[k] = [];
        for (let d = -fineSpan; d <= fineSpan; d++) axes[k].push(clampParam(k, seed.params[k] + d * FINE_STEP[k]));
        axes[k] = [...new Set(axes[k])];
      }
      for (const p of cartesian(axes)) {
        run(p);
        if (++done % 200 === 0) yield Math.min(done / total, 0.99);
      }
    }
    return rank([...results.values()], results);
  }

  // Sort by cost, then by how bad the nearby settings are, so the pick sits
  // inside a good region instead of on the edge of a cliff.
  function rank(list, results) {
    for (const r of list) r.neighbourCost = neighbourCost(r.params, results);
    return list.sort((a, b) => a.cost - b.cost || a.neighbourCost - b.neighbourCost);
  }

  function neighbourCost(params, results) {
    let sum = 0;
    let n = 0;
    for (const k of PARAM_KEYS) {
      for (const d of [-1, 1]) {
        const q = { ...params, [k]: clampParam(k, params[k] + d * FINE_STEP[k]) };
        const r = results.get(keyOf(q));
        if (r) {
          sum += r.cost;
          n++;
        }
      }
    }
    return n ? sum / n : Infinity;
  }

  const SWEEP = {
    holdTimeout: range(100, 255, 5),
    overlapThreshold: range(0, 100, 5),
    minHoldTime: range(10, 250, 10),
    minPriorInterval: range(10, 250, 10),
  };

  function sweep(prepared, base, key) {
    return SWEEP[key].map((v) => {
      const r = evaluate(prepared, { ...base, [key]: v });
      return { value: v, falseHolds: r.falseHolds, falseTaps: r.falseTaps };
    });
  }

  function percentile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
    return sorted[idx];
  }

  // Raw timing for labelled home-row presses, independent of any settings.
  function timingStats(prepared) {
    const s = {
      tapDwell: [],
      tapRollOverlap: [],
      tapNextReleasedFirst: [],
      tapPriorGap: [],
      holdPriorGap: [],
      holdToLetter: [],
      holdReleaseAfterLetter: [],
      taps: 0,
      tapRolls: 0,
    };
    for (const p of prepared) {
      const ev = p.events;
      let lastPrintableDown = -Infinity;
      for (let i = 0; i < ev.length; i++) {
        const e = ev[i];
        const label = p.labels.get(e.id);
        if (e.down && (label === "tap" || label === "hold")) {
          const up = findRelease(ev, i);
          const next = findNextPress(ev, i);
          const gap = e.t - lastPrintableDown;
          if (label === "tap") {
            s.taps++;
            if (up) s.tapDwell.push(up.t - e.t);
            if (Number.isFinite(gap)) s.tapPriorGap.push(gap);
            if (up && next && next.t < up.t) {
              s.tapRolls++;
              const nextUp = findRelease(ev, ev.indexOf(next));
              if (nextUp && nextUp.t > up.t) {
                s.tapRollOverlap.push(Math.round((100 * (up.t - next.t)) / Math.max(1, nextUp.t - next.t)));
              } else if (nextUp) {
                s.tapNextReleasedFirst.push(nextUp.t - e.t);
              }
            }
          } else {
            if (Number.isFinite(gap)) s.holdPriorGap.push(gap);
            if (next) {
              s.holdToLetter.push(next.t - e.t);
              const nextUp = findRelease(ev, ev.indexOf(next));
              if (up && nextUp) s.holdReleaseAfterLetter.push(up.t - nextUp.t);
            }
          }
        }
        if (e.down && Sim.isPrintableCode(e.code)) lastPrintableDown = e.t;
      }
    }
    return s;
  }

  function findRelease(ev, i) {
    for (let j = i + 1; j < ev.length; j++) if (!ev[j].down && ev[j].code === ev[i].code) return ev[j];
    return null;
  }

  function findNextPress(ev, i) {
    const up = findRelease(ev, i);
    for (let j = i + 1; j < ev.length; j++) {
      if (up && ev[j] === up) return null;
      if (ev[j].down) return ev[j];
    }
    return null;
  }

  const api = {
    QUKEY_CODES, LIMITS, PARAM_KEYS, SWEEP,
    prepare, evaluate, cost, search, sweep, timingStats, percentile,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TunerCore = api;
})(typeof self !== "undefined" ? self : this);
