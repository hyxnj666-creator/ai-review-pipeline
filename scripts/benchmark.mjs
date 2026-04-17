#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const casesPath = resolve(root, 'benchmarks', 'cases.json');

if (!existsSync(casesPath)) {
  console.error('Benchmark cases file not found:', casesPath);
  process.exit(1);
}

const args = process.argv.slice(2);
const lang = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'zh';
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : '';
const caseFilter = args.includes('--case') ? args[args.indexOf('--case') + 1] : '';

const cases = JSON.parse(readFileSync(casesPath, 'utf-8'));
const selectedCases = caseFilter ? cases.filter((item) => item.id === caseFilter) : cases;

if (selectedCases.length === 0) {
  console.error('No benchmark cases matched.');
  process.exit(1);
}

function runCli(caseItem) {
  const cliPath = resolve(root, 'bin', 'cli.mjs');
  const cliArgs = [cliPath, '--json', '--no-test', '--no-report', '--file', caseItem.file, '--full', '--lang', lang];
  if (model) cliArgs.push('--model', model);

  const result = spawnSync(process.execPath, cliArgs, {
    cwd: root,
    encoding: 'utf-8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();

  if (!stdout) {
    return {
      ok: false,
      reason: stderr || 'No JSON output returned',
      exitCode: result.status ?? 1,
    };
  }

  try {
    const parsed = extractJson(stdout);
    return { ok: true, parsed, stderr, exitCode: result.status ?? 0 };
  } catch {
    return {
      ok: false,
      reason: `Invalid JSON output: ${stdout.slice(0, 300)}`,
      exitCode: result.status ?? 1,
    };
  }
}

function extractJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('No JSON object found');
    }
    return JSON.parse(stdout.slice(start, end + 1));
  }
}

function includesPattern(issue, pattern) {
  const text = `${issue.title || ''}\n${issue.desc || ''}\n${issue.fix || ''}\n${issue.code || ''}`;
  return new RegExp(pattern, 'i').test(text);
}

function evaluateCase(caseItem, parsed) {
  const issues = parsed.issues || [];
  const failures = [];

  if (typeof caseItem.expect?.minIssueCount === 'number' && issues.length < caseItem.expect.minIssueCount) {
    failures.push(`Expected at least ${caseItem.expect.minIssueCount} total issue(s), got ${issues.length}`);
  }

  for (const [severity, minCount] of Object.entries(caseItem.expect?.minCounts || {})) {
    const actual = issues.filter((issue) => issue.severity === severity).length;
    if (actual < minCount) {
      failures.push(`Expected at least ${minCount} ${severity} issue(s), got ${actual}`);
    }
  }

  for (const [severity, maxCount] of Object.entries(caseItem.expect?.maxCounts || {})) {
    const actual = issues.filter((issue) => issue.severity === severity).length;
    if (actual > maxCount) {
      failures.push(`Expected at most ${maxCount} ${severity} issue(s), got ${actual}`);
    }
  }

  for (const pattern of caseItem.expect?.mustInclude || []) {
    const matched = issues.some((issue) => includesPattern(issue, pattern));
    if (!matched) failures.push(`Missing expected pattern: ${pattern}`);
  }

  for (const pattern of caseItem.expect?.mustNotInclude || []) {
    const matched = issues.some((issue) => includesPattern(issue, pattern));
    if (matched) failures.push(`Found forbidden pattern: ${pattern}`);
  }

  if (typeof caseItem.expect?.maxScore === 'number' && parsed.score > caseItem.expect.maxScore) {
    failures.push(`Expected score <= ${caseItem.expect.maxScore}, got ${parsed.score}`);
  }

  if (typeof caseItem.expect?.minScore === 'number' && parsed.score < caseItem.expect.minScore) {
    failures.push(`Expected score >= ${caseItem.expect.minScore}, got ${parsed.score}`);
  }

  return failures;
}

let passed = 0;
let failed = 0;

console.log(`Running ${selectedCases.length} benchmark case(s)...`);
console.log();

for (const caseItem of selectedCases) {
  const result = runCli(caseItem);
  if (!result.ok) {
    failed += 1;
    console.log(`FAIL  ${caseItem.id}`);
    console.log(`  ${result.reason}`);
    console.log();
    continue;
  }

  const failures = evaluateCase(caseItem, result.parsed);
  if (failures.length === 0) {
    passed += 1;
    console.log(`PASS  ${caseItem.id}`);
    console.log(`  score=${result.parsed.score} red=${result.parsed.red} yellow=${result.parsed.yellow} green=${result.parsed.green} blue=${result.parsed.blue || 0}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${caseItem.id}`);
    console.log(`  score=${result.parsed.score} red=${result.parsed.red} yellow=${result.parsed.yellow} green=${result.parsed.green} blue=${result.parsed.blue || 0}`);
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
  }
  console.log();
}

console.log(`Done. passed=${passed}, failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
