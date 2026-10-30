const test = require("node:test");
const assert = require("node:assert");
const { simulate } = require("../qukeys-sim.js");

const CURRENT = { holdTimeout: 130, overlapThreshold: 80, minHoldTime: 80, minPriorInterval: 75 };

// "a0 s60 a^100 s^150" -> press a at 0, press s at 60, release a at 100, ...
function seq(spec) {
  const names = { a: "KeyA", s: "KeyS", d: "KeyD", k: "KeyK", t: "KeyT", ";": "Semicolon", _: "Space" };
  return spec.split(/\s+/).map((tok, id) => {
    const m = tok.match(/^(.)(\^?)(\d+)$/);
    return { id, code: names[m[1]], down: m[2] !== "^", t: Number(m[3]) };
  });
}

function run(spec, params = CURRENT) {
  const events = seq(spec);
  const res = simulate(events, params);
  const typed = res.output
    .filter((o) => o.down && o.key.type === "char")
    .map((o) => {
      const held = res.output.filter((p) => p.t <= o.t && p.key.type === "shift");
      let shift = 0;
      for (const p of held) if (p !== o) shift += p.down ? 1 : -1;
      const ch = o.code === "Semicolon" ? ";" : o.code.slice(3).toLowerCase();
      return shift > 0 ? ch.toUpperCase() : ch;
    })
    .join("");
  return { first: res.qukeyResults.get(0), typed, res };
}

test("tap alone", () => {
  const r = run("a0 a^90");
  assert.deepStrictEqual([r.first.kind, r.first.reason], ["tap", "released-alone"]);
  assert.strictEqual(r.typed, "a");
});

test("held alone fires Shift after hold timeout", () => {
  const r = run("a0 a^200");
  assert.deepStrictEqual([r.first.kind, r.first.reason, r.first.at], ["hold", "hold-timeout", 131]);
});

test("normal roll resolves as tap via overlap threshold", () => {
  const r = run("a0 s60 a^100 s^150");
  assert.deepStrictEqual([r.first.kind, r.first.reason, r.first.at], ["tap", "rollover", 111]);
  assert.strictEqual(r.typed, "as");
});

test("next key released first after minimum hold time gives Shift", () => {
  const r = run("a0 s50 s^110 a^120");
  assert.deepStrictEqual([r.first.kind, r.first.reason, r.first.at], ["hold", "other-key-released", 110]);
  assert.strictEqual(r.typed, "S");
});

test("next key released before minimum hold time still Shifts once it expires", () => {
  const r = run("a0 s30 s^70 a^90");
  assert.deepStrictEqual([r.first.kind, r.first.at], ["hold", 81]);
});

test("press soon after a printable key is forced to tap", () => {
  const r = run("k0 a50 k^60 a^200");
  const a = r.res.qukeyResults.get(1);
  assert.deepStrictEqual([a.kind, a.reason, a.at], ["tap", "prior-interval", 50]);
});

test("space does not count as prior keypress", () => {
  const r = run("_0 a50 _^60 a^200");
  const a = r.res.qukeyResults.get(1);
  assert.strictEqual(a.kind, "hold");
});

test("qukey released while next key held, next key released within overlap window", () => {
  const r = run("a0 s50 a^100 s^105");
  assert.deepStrictEqual([r.first.kind, r.first.reason], ["hold", "overlap"]);
});

test("intended shift on right hand", () => {
  const r = run(";0 t100 t^180 ;^220");
  assert.strictEqual(r.first.kind, "hold");
  assert.strictEqual(r.typed, "T");
});

test("skipping idle cycles gives the same result as running every cycle", () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const codes = ["KeyA", "KeyS", "KeyD", "KeyK", "Semicolon", "Space", "KeyT"];
  for (let round = 0; round < 300; round++) {
    const events = [];
    let t = 0;
    for (let k = 0; k < 40; k++) {
      t += Math.floor(rand() * 90);
      const code = codes[Math.floor(rand() * codes.length)];
      const len = 30 + Math.floor(rand() * 250);
      events.push({ code, down: true, t }, { code, down: false, t: t + len });
    }
    // Drop overlapping presses of the same key, then sort.
    events.sort((x, y) => x.t - y.t);
    const held = new Set();
    const clean = [];
    for (const e of events) {
      if (e.down && held.has(e.code)) continue;
      if (!e.down && !held.has(e.code)) continue;
      e.down ? held.add(e.code) : held.delete(e.code);
      clean.push({ ...e, id: clean.length });
    }
    const params = {
      holdTimeout: 100 + Math.floor(rand() * 155),
      overlapThreshold: Math.floor(rand() * 101),
      minHoldTime: 1 + Math.floor(rand() * 200),
      minPriorInterval: 1 + Math.floor(rand() * 200),
    };
    const fast = simulate(clean, params);
    const slow = simulate(clean, params, { everyCycle: true });
    assert.deepStrictEqual([...fast.qukeyResults], [...slow.qukeyResults], JSON.stringify(params));
    assert.deepStrictEqual(fast.output, slow.output);
  }
});
