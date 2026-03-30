#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setLang, t } from '../src/core/logger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));

const args = process.argv.slice(2);
const command = args[0];

// Global options
const langIdx = args.indexOf('--lang');
if (langIdx !== -1 && args[langIdx + 1]) {
  setLang(args[langIdx + 1]);
}

if (args.includes('--version') || args.includes('-v')) {
  console.log(`ai-review-pipeline v${pkg.version}`);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`\nai-review-pipeline v${pkg.version}\n`);
  console.log(t('helpText'));
  console.log();
  process.exit(0);
}

const isFlag = !command || command.startsWith('-');

try {
  if (isFlag) {
    // No subcommand (e.g. `ai-rp --file src/a.vue` or `ai-rp --fix`)
    const { run } = await import('../src/commands/pipeline.mjs');
    await run(args);
  } else if (command === 'review') {
    const { run } = await import('../src/commands/pipeline.mjs');
    await run(args.slice(1));
  } else if (command === 'fix') {
    const subArgs = args.slice(1);
    if (!subArgs.includes('--fix')) subArgs.unshift('--fix');
    const { run } = await import('../src/commands/pipeline.mjs');
    await run(subArgs);
  } else if (command === 'test') {
    const { run } = await import('../src/commands/test.mjs');
    await run(args.slice(1));
  } else if (command === 'init') {
    const { run } = await import('../src/commands/init.mjs');
    await run();
  } else {
    console.error(`❌ Unknown command: ${command}`);
    console.log(`Run "ai-rp --help" for usage.`);
    process.exit(1);
  }
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
