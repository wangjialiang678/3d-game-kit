# @kit/core

Reusable middleware shared by demos. Game-specific semantics stay in each demo and are injected into these helpers.

| Module | Purpose | Injection points |
|---|---|---|
| `rules-core.mjs` | ECA rule validation/simulation core. | Registered events, trigger events, and closed action vocabulary. |
| `content-pipeline.mjs` | JSON pack loading plus optional validator orchestration. | File map, reader implementation, pack builder, validators. |
| `FlightRecorder.ts` | Ring-buffer telemetry, input replay, F9 diagnostic dump, watchdog alerts. | State sampler, final-state sampler, EventBus, Input adapter, watchdog assertions. |
| `spatial.mjs` | Small pure spatial/hash utilities. | Block list and margins supplied by each game. |
| `vite-content-save.mjs` | Dev-only Vite POST save endpoint for content editors. | Target file map and optional payload validator. |
| `playtest-lib.mjs` | Puppeteer/Vite playtest runner core. | URL, timeout, result expression, server port/cwd, report labels. |
| `sim-harness.mjs` | L0/L1 simulation command output and exit-code harness. | Scenario checks remain in each demo. |
