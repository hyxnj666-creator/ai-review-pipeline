import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { execSync } from 'node:child_process';
import { loadEnv } from '../core/env.mjs';
import { loadConfig, getEnvConfig } from '../core/config.mjs';
import { initProxy } from '../core/ai-client.mjs';
import { log, separator, t, createSpinner, getLang } from '../core/logger.mjs';
import { collectCodeFiles, detectStack, runAiTestPipeline } from '../core/test-executor.mjs';

const CODE_EXT = /\.(ts|tsx|vue|js|jsx|py|mjs|cjs|go|rs|java|kt|swift|rb|php|cs|uvue)$/;

export async function run(args) {
  loadEnv();
  const config = loadConfig();
  const env = getEnvConfig();
  const cliModel = args.includes('--model') ? args[args.indexOf('--model') + 1] : '';
  const ignoreConfigModelForBuiltinFallback = env.builtinFallback && !cliModel && !process.env.AI_REVIEW_MODEL;
  const configModel = ignoreConfigModelForBuiltinFallback ? '' : config.review.model;
  const model = cliModel || configModel || env.model;

  if (!env.apiKey && env.provider !== 'ollama') { console.error(`❌ ${t('noApiKey')}`); process.exit(1); }
  if (env.builtinFallback) log('💡', t('builtinFallback'));
  if (env.ignoredModelOverride) log('⚠️', t('builtinFallbackIgnoreModel', env.requestedModel));
  if (ignoreConfigModelForBuiltinFallback && config.review.model) log('⚠️', t('builtinFallbackIgnoreConfigModel', config.review.model));

  await initProxy(env.proxy);

  const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
  const staged = args.includes('--staged');
  const runTests = args.includes('--run-tests') || (!args.includes('--no-run-tests') && config.test.run !== false);

  let sourceCode = '';
  let fileName = '';
  let targetFiles = [];

  if (file) {
    const fullPath = resolve(process.cwd(), file);
    if (!existsSync(fullPath)) { console.error(`❌ File not found: ${file}`); process.exit(1); }
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      const files = collectCodeFiles(fullPath).map((f) => relative(process.cwd(), f));
      if (files.length === 0) { console.log(`✅ ${t('testNoFiles')}`); process.exit(0); }
      sourceCode = files.map((f) => {
        try { return `// ===== ${f} =====\n${readFileSync(resolve(process.cwd(), f), 'utf-8')}`; }
        catch { return ''; }
      }).filter(Boolean).join('\n\n');
      fileName = files.join(', ');
      targetFiles = files;
    } else {
      sourceCode = readFileSync(fullPath, 'utf-8');
      fileName = file;
      targetFiles = [file];
    }
  } else if (staged) {
    try {
      const files = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf-8' })
        .trim().split('\n').filter(Boolean)
        .filter((f) => CODE_EXT.test(f));
      if (files.length === 0) { console.log(`✅ ${t('testNoFiles')}`); process.exit(0); }
      sourceCode = files.map((f) => {
        try { return `// ===== ${f} =====\n${readFileSync(resolve(process.cwd(), f), 'utf-8')}`; }
        catch { return ''; }
      }).filter(Boolean).join('\n\n');
      fileName = files.join(', ');
      targetFiles = files;
    } catch { console.error('❌ Failed to get staged files'); process.exit(1); }
  } else {
    console.error('Usage: ai-rp test --file <path> or --staged');
    process.exit(1);
  }

  if (!sourceCode.trim()) { console.log(`✅ ${t('noChanges')}`); process.exit(0); }

  const MAX_CHARS = 50000;
  if (sourceCode.length > MAX_CHARS) {
    sourceCode = sourceCode.slice(0, MAX_CHARS) + '\n\n... (truncated)';
  }

  const stack = config.test.stack !== 'auto' ? config.test.stack : detectStack(sourceCode, fileName);

  log('📝', t('testTarget', fileName));
  log('🔧', t('testDetectStack', stack));
  log('📏', t('testCodeLen', sourceCode.split('\n').length));
  console.log();
  log('⏳', t('testGenerating'));

  const spinner = createSpinner(t('testGenerating'));
  spinner.start();
  const t0 = Date.now();
  const result = await runAiTestPipeline({
    sourceCode,
    fileLabel: fileName,
    targetFiles,
    env,
    model,
    config,
    lang: getLang(),
    runTests,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  spinner.stop();

  separator(t('testTitle'));
  console.log(result.output);
  console.log();

  if (result.execution.attempted) {
    log(result.execution.passed ? '✅' : '❌', t('testExecStatus', result.execution.passed ? t('testExecPassed') : t('testExecFailed')));
    log('🧪', t('testExecRunner', result.execution.runner, result.execution.elapsedMs));
    if (result.execution.tempFile) log('📄', t('testExecTempFile', result.execution.tempFile, result.execution.keptFile));
    if (!result.execution.passed) {
      if (result.execution.reason) log('⚠️', result.execution.reason);
      if (result.execution.stdout) console.log(`\n[stdout]\n${result.execution.stdout}`);
      if (result.execution.stderr) console.log(`\n[stderr]\n${result.execution.stderr}`);
    }
  } else {
    log('ℹ️', t('testExecSkipped', result.execution.reason));
  }

  console.log();
  console.log('─'.repeat(60));
  log('⏱️', `${t('model', model)} | ${t('reviewTime', elapsed)}${result.tokens ? ` | ${t('tokens', result.tokens.prompt_tokens, result.tokens.completion_tokens, result.tokens.total_tokens)}` : ''}`);
  console.log('═'.repeat(60));

  if (result.execution.attempted && !result.execution.passed) process.exit(1);
}

export { detectStack };
