# Third-party code

- **mGBA** (WebAssembly build `@thenick775/mgba-wasm` 2.5.1, in `mgba/`) — Mozilla Public License 2.0.
  Source: https://github.com/thenick775/mgba/tree/feature/wasm (fork of https://github.com/mgba-emu/mgba).
  Modified: `mgba/mgba.js` has a short block added at the top (marked "RR Nuzlocke: game clock override") so the
  app's time-of-day button reaches the emulator's worker threads. The .wasm is unmodified.
- **Damage engine** (`overlay/engine.js`) — RadicalRedShowdown/calc, MIT, © Honko and contributors.

No game ROM is included or hosted. You load your own Radical Red ROM; it stays on your device.
