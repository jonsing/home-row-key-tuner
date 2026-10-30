// Fake typing for tests and benchmarks: random dwell/flight times with
// rollover, "a" and ";" pressed as plain keys, capitals typed by holding the
// opposite home-row key.
function synthSession(chars, seed = 1) {
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const text = "the cat sat on a mat and Ada asked Sam what a Map was ";
  const left = new Set("qwertasdfgzxcvb");
  const events = [];
  let t = 0;
  for (let i = 0; i < chars; i++) {
    const ch = text[i % text.length];
    const lower = ch.toLowerCase();
    const code = ch === " " ? "Space" : "Key" + lower.toUpperCase();
    if (ch !== lower) {
      const shiftCode = left.has(lower) ? "Semicolon" : "KeyA";
      const shiftKey = shiftCode === "KeyA" ? "a" : ";";
      const letterDown = t + 60 + rand() * 100;
      const letterUp = letterDown + 60 + rand() * 60;
      events.push({ t, code: shiftCode, key: shiftKey, down: true, label: "hold" });
      events.push({ t: letterDown, code, key: lower, down: true, label: code === "KeyA" ? "tap" : undefined });
      events.push({ t: letterUp, code, key: lower, down: false });
      events.push({ t: letterUp + (rand() * 80 - 30), code: shiftCode, key: shiftKey, down: false });
      t = letterDown + 90 + rand() * 80;
      continue;
    }
    const dwell = 60 + rand() * 90;
    events.push({ t, code, key: lower, down: true, label: code === "KeyA" ? "tap" : undefined });
    events.push({ t: t + dwell, code, key: lower, down: false });
    t += 50 + rand() * 120;
  }
  events.sort((x, y) => x.t - y.t);
  const labels = {};
  events.forEach((e, i) => {
    if (e.label) labels[i] = e.label;
    delete e.label;
  });
  return { id: "synthetic-" + seed, target: text, events, labels };
}

module.exports = { synthSession };
