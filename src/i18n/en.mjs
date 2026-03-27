export default {
  noApiKey: 'Missing API Key. Set OPENAI_API_KEY or AI_REVIEW_API_KEY in .env.local or environment.',
  noChanges: 'No code changes detected.',
  diffLines: (n, label, trunc) => `Detected ${n} lines of changes (${label})${trunc ? ', truncated' : ''}`,
  model: (m) => `Model: ${m}`,
  threshold: (t) => `Threshold: ${t}`,
  maxRounds: (n) => `Max rounds: ${n}`,
  mode: (m) => `Mode: ${m}`,
  target: (t) => `Target: ${t}`,
  modeReviewOnly: 'Review-only (read-only)',
  modeFix: 'Review + Auto-fix',
  modeDryRun: 'Dry-run (report only, no changes, no blocking)',
  roundTitle: (n) => `Round ${n} Code Review`,
  score: (s, r, y, g) => `Score: ${s}/100 | 🔴${r} 🟡${y} 🟢${g}`,
  passed: (s, t) => `Quality passed (${s} >= ${t}). Review passed!`,
  reviewOnlyHint: 'Review-only mode: issues above require manual fix.',
  fixHint: 'To auto-fix, use the fix command.',
  dryRunSkip: 'Dry-run mode: skipping fix, generating tests and report.',
  maxRoundsReached: (n) => `Reached max rounds ${n}, stopping auto-fix.`,
  fixRound: (n) => `Round ${n} Auto-fix`,
  fixSafetyNote: 'Auto-fix only addresses code quality issues, not business logic.',
  fixFile: (f, n) => `Fixing ${f} (${n} issues)...`,
  fixDone: (f) => `${f} fixed`,
  fixFail: (f) => `${f} fix failed, manual intervention needed`,
  fixTooShort: (f, r) => `${f} fix result too short (below ${r}% of original), skipped`,
  fixCount: (n) => `Fixed ${n} files this round.`,
  fixDiffTitle: 'Changes from this round (git diff)',
  noFixNeeded: 'No issues to fix.',
  nextRound: 'Starting next review round...',
  testTitle: 'AI Test Case Generation',
  testTarget: (f) => `Target files: ${f}`,
  testNoFiles: 'No changed code files, skipping test generation.',
  reportGenerated: (p) => `Report generated: ${p}`,
  commitTitle: 'Auto Commit',
  commitDone: (m) => `Committed: ${m}`,
  commitFail: (e) => `Commit failed: ${e}`,
  pipelineTitle: 'AI Quality Pipeline',
  resultPass: 'Passed',
  resultFail: 'Failed',
  resultDryRun: 'Report generated (dry-run, no blocking)',
  finalScore: (s) => `Final score: ${s}/100`,
  finalRounds: (n) => `Rounds: ${n}`,
  finalReport: (p) => `Report: ${p}`,
  dryRunDone: 'Dry-run complete, no code was modified.',
  fixSuggest: 'To auto-fix, run: ai-rp fix',
  reviewOnlySuggest: 'Review-only mode. To auto-fix, run: ai-rp fix',
  manualSuggest: 'Suggestion: manually fix remaining issues and re-run, or increase --max-rounds',
  autoCommit: (v) => `Auto commit: ${v ? 'yes' : 'no'}`,
  autoTest: (v) => `Generate tests: ${v ? 'yes' : 'no'}`,
  initCreated: (p) => `Config file created: ${p}`,
  initExists: (p) => `Config file already exists: ${p}, skipped.`,
  initDone: 'Done! Edit .ai-pipeline.json to customize review rules.',
  testDetectStack: (s) => `Detected stack: ${s}`,
  testCodeLen: (n) => `Code length: ${n} lines`,
  testGenerating: 'Calling AI to generate test cases...',
  reviewTitle: 'AI Code Review Report',
  reviewResult: (pass) => `Result: ${pass ? '✅ PASS' : '❌ BLOCKED'}`,
  reviewTime: (s) => `Time: ${s}s`,
  tokens: (p, c, t) => `Tokens: ${p}+${c}=${t}`,
  helpText: `
ai-review-pipeline — AI-powered code quality pipeline

Commands:
  review    AI Code Review (read-only, no code changes)
  fix       Review + auto-fix + test + commit pipeline
  test      AI test case generation
  init      Initialize config file (.ai-pipeline.json)

Global options:
  --file <path>       Target file/folder/multi-path (comma-separated)
  --lang <zh|en>      Output language (default: zh)
  --help              Show help
  --version           Show version

review options:
  --staged            Review staged changes
  --branch <base>     Compare branch (e.g. main)
  --json              JSON output (for CI)
  --no-report         Skip HTML report

fix options:
  --dry-run           Full pipeline → report only, no changes, no blocking
  --threshold <n>     Quality threshold (default: 95)
  --max-rounds <n>    Max fix rounds (default: 3)
  --no-commit         Don't auto-commit after fix
  --no-test           Skip test case generation
  --skip <levels>     Skip fix levels (e.g. green,yellow)

test options:
  --staged            Generate tests for staged files

Examples:
  npx ai-rp review
  npx ai-rp review --file src/components
  npx ai-rp fix --dry-run
  npx ai-rp fix --threshold 90
  npx ai-rp test --file src/utils.ts
  npx ai-rp init
`.trim(),
};
