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

if (args.includes('--help') || args.includes('-h') || !command) {
  console.log(`\nai-review-pipeline v${pkg.version}\n`);
  console.log(t('helpText'));
  console.log();
  process.exit(0);
}

const subArgs = args.slice(1);

try {
  switch (command) {
    case 'review': {
      const { run } = await import('../src/commands/review.mjs');
      await run(subArgs);
      break;
    }
    case 'fix': {
      const { run } = await import('../src/commands/fix.mjs');
      await run(subArgs);
      break;
    }
    case 'test': {
      const { run } = await import('../src/commands/test.mjs');
      await run(subArgs);
      break;
    }
    case 'init': {
      const { run } = await import('../src/commands/init.mjs');
      await run();
      break;
    }
    default:
      console.error(`❌ Unknown command: ${command}`);
      console.log(`Run "ai-rp --help" for usage.`);
      process.exit(1);
  }
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
