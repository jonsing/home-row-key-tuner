// Port of the tap/hold decision logic in Dygma's Kaleidoscope Qukeys plugin
// (src/kaleidoscope/plugin/Qukeys.cpp in Dygmalab/Kaleidoscope-Dygma, copy in
// reference-Qukeys.cpp). With Fast Superkeys enabled, a superkey with only a
// tap key and a hold modifier is rewritten into a Qukey, so this is the logic
// that decides between "a" and Shift.
//
// The port keeps the firmware's quirks on purpose (e.g. processQueue() does not
// return after the minimum-prior-interval flush), because the goal is to
// predict what the keyboard does, not what it should do.
(function (root) {
  "use strict";

  const QUEUE_CAPACITY = 8;

  const MODIFIER_CODES = new Set([
    "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
    "AltLeft", "AltRight", "MetaLeft", "MetaRight",
  ]);

  // HID Key_A..Key_0 and Key_Minus..Key_Slash, the range flushEvent() treats as
  // "printable" when recording the prior keypress timestamp. Space, Enter, Tab
  // and Backspace are outside it.
  const PRINTABLE_CODES = new Set([
    "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash",
    "Semicolon", "Quote", "Backquote", "Comma", "Period", "Slash",
  ]);

  function isPrintableCode(code) {
    return /^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code) || PRINTABLE_CODES.has(code);
  }

  function isModifierCode(code) {
    return MODIFIER_CODES.has(code);
  }

  // Key values passed around like the firmware's `Key`.
  const KEY_NONE = { type: "none" };
  const KEY_SHIFT = { type: "shift" };
  const charKey = (code) => ({ type: "char", code });

  // events: [{ id, t, code, down }] sorted by t (integer ms).
  // params: { holdTimeout, overlapThreshold, minHoldTime, minPriorInterval }
  // options.qukeyCodes: codes acting as tap=letter / hold=Shift.
  // Returns { qukeyResults: Map(id -> { kind, reason, at }), output: [...] }.
  function simulate(events, params, options = {}) {
    const qukeyCodes = options.qukeyCodes || new Set(["KeyA", "Semicolon"]);
    const recordOutput = options.recordOutput !== false;
    const holdTimeout = params.holdTimeout;
    const overlapThreshold = params.overlapThreshold;
    const minHoldTime = params.minHoldTime;
    const minPriorInterval = params.minPriorInterval;

    let now = events.length ? events[0].t : 0;
    let priorKeypress = now - 100000;
    const queue = [];
    // Mirrors `queue_head_`, which is only refreshed by isQukey().
    let headPrimary = KEY_NONE;
    let headAlternate = KEY_NONE;
    let flushedThisCycle = false;
    const pressedAs = new Map();
    const qukeyResults = new Map();
    const output = [];
    let anomalies = 0;

    const hasTimeExpired = (start, ttl) => now - start > ttl;

    function emit(code, down, key, id) {
      if (!recordOutput) return;
      output.push({ t: now, code, down, key, id });
    }

    function isQukey(code) {
      if (qukeyCodes.has(code)) {
        headPrimary = charKey(code);
        headAlternate = KEY_SHIFT;
        return true;
      }
      headPrimary = charKey(code);
      headAlternate = KEY_NONE;
      return false;
    }

    function flushEvent(key, reason) {
      const ev = queue.shift();
      if (!ev) {
        anomalies++;
        return;
      }
      flushedThisCycle = true;
      if (ev.down && key.type === "char" && isPrintableCode(key.code)) {
        priorKeypress = ev.t;
      }
      if (ev.down) {
        pressedAs.set(ev.code, key);
        if (qukeyCodes.has(ev.code)) {
          qukeyResults.set(ev.id, { kind: key.type === "shift" ? "hold" : "tap", reason, at: now });
        }
        emit(ev.code, true, key, ev.id);
      } else {
        emit(ev.code, false, pressedAs.get(ev.code) || KEY_NONE, ev.id);
        pressedAs.delete(ev.code);
      }
    }

    function releaseDelayed(overlapStart, overlapEnd) {
      const duration = overlapEnd - overlapStart;
      const releaseTimeout = Math.floor((duration * 100) / overlapThreshold) & 0xffff;
      return !hasTimeExpired(overlapStart, releaseTimeout);
    }

    function processQueue() {
      if (queue.length === 0) return true;
      const headCode = queue[0].code;

      if (!queue[0].down) {
        flushEvent(KEY_NONE, "release");
        return true;
      }

      if (!isQukey(headCode)) {
        flushEvent(headPrimary, "plain");
        return true;
      }

      let nextKeypressIndex = 0;

      if (!hasTimeExpired(priorKeypress, minPriorInterval)) {
        flushEvent(headPrimary, "prior-interval");
      }

      for (let i = 1; i < queue.length; i++) {
        if (queue[i].down) {
          if (nextKeypressIndex === 0) nextKeypressIndex = i;
          continue;
        }

        if (queue[i].code === headCode) {
          if (nextKeypressIndex === 0 || overlapThreshold === 0) {
            flushEvent(headPrimary, "released-alone");
            return true;
          }
          const overlapStart = queue[nextKeypressIndex].t;
          const overlapEnd = queue[i].t;
          if (releaseDelayed(overlapStart, overlapEnd)) continue;
          flushEvent(headPrimary, "rollover");
          return true;
        }

        for (let j = 1; j < i; j++) {
          if (queue[j].code === queue[i].code) {
            if (hasTimeExpired(queue[0].t, minHoldTime)) {
              let releasedBefore = false;
              for (let k = 1; k < i; k++) {
                if (!queue[k].down && queue[k].code === headCode) releasedBefore = true;
              }
              flushEvent(headAlternate, releasedBefore ? "overlap" : "other-key-released");
              return true;
            }
          }
        }
      }

      if (queue.length >= QUEUE_CAPACITY) {
        flushEvent(headPrimary, "queue-full");
        return true;
      }
      return false;
    }

    function onKeyswitchEvent(ev) {
      if (!ev.down && queue.length === 1 && ev.code !== queue[0].code && !isModifierCode(ev.code)) {
        // Release of a rolled-over plain key skips the queue.
        emit(ev.code, false, pressedAs.get(ev.code) || KEY_NONE, ev.id);
        pressedAs.delete(ev.code);
        return;
      }
      queue.push({ id: ev.id, t: now, code: ev.code, down: ev.down });
      if (queue.length >= QUEUE_CAPACITY) processQueue();
    }

    function beforeReportingState() {
      if (hasTimeExpired(priorKeypress, minPriorInterval)) {
        priorKeypress = now - (minPriorInterval + 1);
      }
      if (processQueue()) return;
      if (queue.length === 0) {
        // Firmware reads a stale timestamp here; never seen in practice.
        anomalies++;
        return;
      }
      if (hasTimeExpired(queue[0].t, holdTimeout)) {
        flushEvent(headAlternate.type === "none" ? headPrimary : headAlternate, "hold-timeout");
      }
    }

    // Earliest future time at which a pending decision can change. Between
    // these points processQueue() would return false without side effects,
    // so cycles in between can be skipped.
    function nextDeadline() {
      if (queue.length === 0) return Infinity;
      const head = queue[0];
      const candidates = [head.t + holdTimeout + 1, head.t + minHoldTime + 1];
      let nextPress = 0;
      for (let i = 1; i < queue.length; i++) {
        if (queue[i].down) {
          if (nextPress === 0) nextPress = i;
        } else if (queue[i].code === head.code && nextPress !== 0 && overlapThreshold !== 0) {
          const start = queue[nextPress].t;
          const timeout = Math.floor(((queue[i].t - start) * 100) / overlapThreshold) & 0xffff;
          candidates.push(start + timeout + 1);
        }
      }
      let best = Infinity;
      for (const c of candidates) if (c > now && c < best) best = c;
      return best;
    }

    let i = 0;
    const n = events.length;
    while (i < n || queue.length > 0) {
      flushedThisCycle = false;
      while (i < n && events[i].t <= now) onKeyswitchEvent(events[i++]);
      beforeReportingState();

      let next;
      if (options.everyCycle) {
        next = i < n || queue.length > 0 ? now + 1 : Infinity;
      } else if (flushedThisCycle && queue.length > 0) {
        next = now + 1;
      } else {
        next = Math.min(i < n ? events[i].t : Infinity, nextDeadline());
      }
      if (next === Infinity) break;
      now = Math.max(now + 1, next);
    }

    return { qukeyResults, output, anomalies };
  }

  // Compare simulated resolutions with labelled intent.
  // labels: Map(id -> "tap" | "hold" | "unknown")
  function score(qukeyResults, labels) {
    const s = { taps: 0, holds: 0, falseHolds: 0, falseTaps: 0, misses: [] };
    for (const [id, intent] of labels) {
      if (intent !== "tap" && intent !== "hold") continue;
      const r = qukeyResults.get(id);
      if (!r) continue;
      if (intent === "tap") {
        s.taps++;
        if (r.kind === "hold") {
          s.falseHolds++;
          s.misses.push({ id, intent, ...r });
        }
      } else {
        s.holds++;
        if (r.kind === "tap") {
          s.falseTaps++;
          s.misses.push({ id, intent, ...r });
        }
      }
    }
    return s;
  }

  const api = { simulate, score, isPrintableCode, isModifierCode, QUEUE_CAPACITY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.QukeysSim = api;
})(typeof self !== "undefined" ? self : this);
