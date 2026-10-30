# Home-row Shift tuner

Finds Superkeys timing settings for home-row Shift on `a` and `;` on a Dygma Defy, based on recordings of your own typing.

Open `index.html` in Chrome (no server or build step needed).

## How it works

With Fast Superkeys on, the firmware rewrites a superkey that has only a tap key and a hold modifier into a Qukey (`KeyRoleManager.cpp` in Dygmalab/Kaleidoscope-Dygma). The tap/hold decision is then made by `Qukeys.cpp`, using the four Bazecor settings: hold timeout, overlap threshold, minimum hold time and minimum prior interval. "Next tap timeout" does not apply to these keys.

`qukeys-sim.js` is a port of that decision logic, quirks included. `reference-Qukeys.cpp` is the firmware source it was ported from.

1. **Capture**: with `a` and `;` set to plain keys, type the shown text. For capitals, hold `a` or `;` as you would hold Shift. The page records every key press and release, and uses the text to label each `a`/`;` press as an intended letter or an intended Shift.
2. **Analyze**: replays the recordings through the simulator, counts false Shifts (letter became Shift) and missed Shifts, searches the settings space, and shows how each setting moves the error counts.

## Tests

```
node --test test/*.test.js
node test/bench.js
```

## License

GPL-3.0, see [LICENSE](LICENSE). The simulator is a port of the GPL-licensed Qukeys plugin from Kaleidoscope (Michael Richters) as modified by Dygma, so the whole project uses the same license.
