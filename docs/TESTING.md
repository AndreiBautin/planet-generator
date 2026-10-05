# Testing

`pnpm verify` runs typecheck, lint, the format check, the tests and the
build. It gates the pre-push hook (`.githooks/pre-push`) and CI
(`.github/workflows/ci.yml`), which run the same one command so they cannot
disagree.

## What is prioritised

**What would be silently wrong.** In this app that is overwhelmingly
determinism: a generator that changed its output would keep working, keep
drawing believable planets, and quietly change every planet anybody ever
shared. Nothing else would notice. So:

- **Literal values** pin the generator's output (`rng.test.ts`): not "the
  same seed gives the same sequence" — which passes for a generator that
  changed consistently — but the actual numbers.
- **Forks are independent** of each other and of draws from the parent, so
  adding a feature cannot reshape existing terrain.
- **Parsing is total**: a malformed seed or config value degrades rather
  than throws, and a config typo cannot switch on the wrong mode.

Generation tests run in Node — no DOM, no WebGL — which also keeps the layer
honest about not reaching for either.

## What is deliberately not tested, and why

- **Rendering.** Whether a shader looks right is a judgement made by eye in
  the browser, not an assertion. Snapshotting pixels across GPUs and drivers
  produces tests that fail for reasons unrelated to the code. Render code is
  kept thin so there is little logic in it to get wrong.
- **Three.js itself**, and that a mesh was added to a scene: that is testing
  the library, or asserting the code calls what the test expected it to call.
- **Frame timing and performance.** Measured in the browser with real
  hardware when it matters, not in a unit test.
- **A coverage percentage.** Coverage is reported (`pnpm test:coverage`) but
  not gated; a target produces tests written to raise a number.
