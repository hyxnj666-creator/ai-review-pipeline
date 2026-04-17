# Benchmark Cases

These fixtures are used to evaluate review quality after prompt/model/rule changes.

## Current goals

- Keep detecting real risks such as unsafe HTML injection
- Keep detecting common runtime problems such as missing null checks
- Avoid noisy false positives such as Tailwind "magic number" reports
- Keep detecting hardcoded secrets
- Keep flagging unsafe assertions such as `as any`
- Keep catching uncaught async/network failures
- Keep flagging duplicate-submit or race-prone UI flows

## Run

```bash
npm run benchmark
npm run benchmark -- --model gpt-4o-mini
npm run benchmark -- --case unsafe-html
```

## How to add a case

1. Add a code fixture under `benchmarks/fixtures/`
2. Register it in `benchmarks/cases.json`
3. Define only stable expectations:
   - `minCounts`
   - `maxCounts`
   - `mustInclude`
   - `mustNotInclude`
   - `minScore` / `maxScore`

Keep expectations loose enough to compare quality across models, but strict enough to catch regressions.

## Current cases

- `unsafe-html`
- `unguarded-map`
- `tailwind-noise`
- `hardcoded-secret`
- `unsafe-any`
- `unhandled-fetch`
- `duplicate-submit`
