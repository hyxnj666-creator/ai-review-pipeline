import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { loadEnv } from '../core/env.mjs';
import { loadConfig, getEnvConfig } from '../core/config.mjs';
import { initProxy, callAI } from '../core/ai-client.mjs';
import { getDiff, getChangedFiles } from '../core/diff.mjs';
import { writeReport } from '../core/report.mjs';
import { log, separator, t } from '../core/logger.mjs';
import { buildPrompt, parseReview } from './review.mjs';

// ─── Auto Fix ───
async function fixFile({ filePath, issues, env, model, safetyMinRatio }) {
  const fullPath = resolve(process.cwd(), filePath);
  if (!existsSync(fullPath)) return false;

  const source = readFileSync(fullPath, 'utf-8');
  const issueList = issues.map((i, idx) => `${idx + 1}. [${i.severity}] ${i.title}\n   修复建议: ${i.fix}`).join('\n');

  const prompt = `你是一个资深开发者。请根据 Code Review 的反馈修复以下代码。

## 要求
- 只修复 Review 指出的问题，不要做额外改动
- 不要改变任何业务逻辑和功能行为
- 返回修复后的**完整文件内容**（不要省略任何代码）
- 不要添加解释，只返回代码
- 用 \`\`\`code 包裹

## Review 问题

${issueList}

## 源文件: ${filePath}

\`\`\`
${source}
\`\`\``;

  const { content } = await callAI({ baseUrl: env.baseUrl, apiKey: env.apiKey, model, prompt, temperature: 0.2 });
  const codeMatch = content.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
  if (!codeMatch) return false;

  const fixed = codeMatch[1];
  if (fixed.trim().length < source.trim().length * safetyMinRatio) {
    log('⚠️', t('fixTooShort', filePath, Math.round(safetyMinRatio * 100)));
    return false;
  }

  writeFileSync(fullPath, fixed, 'utf-8');
  return true;
}

async function autoFix({ issues, skipLevels, env, model, safetyMinRatio }) {
  const fileMap = new Map();
  for (const issue of issues) {
    if (!issue.file) continue;
    if (skipLevels.has(issue.severity)) continue;
    if (issue.severity === 'green' && !skipLevels.has('none')) continue;
    if (!fileMap.has(issue.file)) fileMap.set(issue.file, []);
    fileMap.get(issue.file).push(issue);
  }
  if (fileMap.size === 0) return 0;

  let fixed = 0;
  for (const [file, fileIssues] of fileMap) {
    log('🔧', t('fixFile', file, fileIssues.length));
    const ok = await fixFile({ filePath: file, issues: fileIssues, env, model, safetyMinRatio });
    if (ok) { fixed++; log('✅', t('fixDone', file)); }
    else { log('⚠️', t('fixFail', file)); }
  }
  return fixed;
}

// ─── Test generation (embedded) ───
async function generateTests({ files, env, model, config }) {
  const codeFiles = files.filter((f) => existsSync(resolve(process.cwd(), f)));
  if (codeFiles.length === 0) return '';

  const sourceSnippets = codeFiles.map((f) => {
    const code = readFileSync(resolve(process.cwd(), f), 'utf-8');
    const lines = code.split('\n');
    const truncated = lines.length > 200 ? lines.slice(0, 200).join('\n') + '\n// ...' : code;
    return `// ===== ${f} =====\n${truncated}`;
  }).join('\n\n');

  const ext = extname(codeFiles[0]).toLowerCase();
  const stack = config.test.stack !== 'auto' ? config.test.stack :
    ext === '.py' ? 'Python (pytest)' : ext === '.vue' ? 'Vue3 (Vitest)' : 'React/TypeScript (Vitest)';

  const prompt = `你是一个资深测试工程师。技术栈: ${stack}。请为以下代码生成测试用例。

## 分三类
1. **✅ 功能用例** — 正常业务流程
2. **⚔️ 对抗用例** — 异常输入、XSS、越权
3. **🔲 边界用例** — 空值、0、极大值、超时

输出每条用例: [类型] 名称 | 输入 | 预期结果

最后输出 ${config.test.maxCases} 个关键用例的**可运行测试代码**。

## 代码

${sourceSnippets}`;

  const { content, tokens } = await callAI({ baseUrl: env.baseUrl, apiKey: env.apiKey, model, prompt, temperature: 0.4 });
  log('📊', `Test Tokens: ${tokens?.total_tokens || 'N/A'}`);
  return content;
}

// ─── Main pipeline ───
export async function run(args) {
  loadEnv();
  const config = loadConfig();
  const env = getEnvConfig();
  const model = config.review.model || env.model || 'gpt-4o-mini';

  if (!env.apiKey) { console.error(`❌ ${t('noApiKey')}`); process.exit(1); }

  await initProxy(env.proxy);

  const dryRun = args.includes('--dry-run');
  const noCommit = args.includes('--no-commit');
  const noTest = args.includes('--no-test');
  const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
  const maxRounds = Number(args.includes('--max-rounds') ? args[args.indexOf('--max-rounds') + 1] : 0) || config.review.maxRounds;
  const threshold = Number(args.includes('--threshold') ? args[args.indexOf('--threshold') + 1] : 0) || config.review.threshold;
  const skipLevels = new Set(
    (args.includes('--skip') ? (args[args.indexOf('--skip') + 1] || '') : '')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  );

  separator(`🚀 ${t('pipelineTitle')}`);
  const modeLabel = dryRun ? t('modeDryRun') : t('modeFix');
  log('⚙️', t('mode', modeLabel));
  if (file) log('📂', t('target', file));
  log('⚙️', `${t('model', model)} | ${t('threshold', threshold)} | ${t('maxRounds', dryRun ? 1 : maxRounds)}`);
  if (!dryRun) {
    log('⚙️', `${t('autoCommit', !noCommit)} | ${t('autoTest', !noTest)}`);
  }

  let round = 0;
  let lastReview = { score: 0, red: 0, yellow: 0, green: 0, summary: '', issues: [] };
  let passed = false;
  const effectiveMaxRounds = dryRun ? 1 : maxRounds;

  while (round < effectiveMaxRounds) {
    round++;
    separator(`📝 ${t('roundTitle', round)}`);

    const diff = getDiff({ file });
    if (!diff.trim()) {
      log('✅', t('noChanges'));
      passed = true;
      break;
    }

    const truncated = diff.split('\n').length > config.review.maxDiffLines
      ? diff.split('\n').slice(0, config.review.maxDiffLines).join('\n') + '\n... (truncated)'
      : diff;

    log('📏', `${diff.split('\n').length} lines`);
    const prompt = buildPrompt(truncated, config.review.customRules || []);
    const { content, tokens } = await callAI({ baseUrl: env.baseUrl, apiKey: env.apiKey, model, prompt });
    lastReview = parseReview(content);

    console.log('\n' + lastReview.markdown + '\n');
    log('📊', t('score', lastReview.score, lastReview.red, lastReview.yellow, lastReview.green));
    log('💬', lastReview.summary);

    const effectiveRed = skipLevels.has('red') ? 0 : lastReview.red;
    if (lastReview.score >= threshold && effectiveRed === 0) {
      log('🎉', t('passed', lastReview.score, threshold));
      passed = true;
      break;
    }

    if (dryRun) {
      log('📊', t('dryRunSkip'));
      break;
    }

    if (round >= maxRounds) {
      log('⚠️', t('maxRoundsReached', maxRounds));
      break;
    }

    // ── Auto Fix ──
    separator(`🔧 ${t('fixRound', round)}`);
    log('⚠️', t('fixSafetyNote'));

    const fixableIssues = lastReview.issues.filter((i) => i.severity !== 'green');
    if (fixableIssues.length === 0) {
      log('✅', t('noFixNeeded'));
      passed = true;
      break;
    }

    const fixedCount = await autoFix({
      issues: fixableIssues,
      skipLevels,
      env,
      model,
      safetyMinRatio: config.fix.safetyMinRatio,
    });
    log('📦', t('fixCount', fixedCount));

    if (fixedCount > 0) {
      separator(`📋 ${t('fixDiffTitle')}`);
      try {
        console.log(execSync('git diff --stat', { encoding: 'utf-8' }));
        const detail = execSync('git diff --no-color', { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 });
        const lines = detail.split('\n');
        if (lines.length > 100) {
          console.log(lines.slice(0, 100).join('\n'));
          console.log(`\n... ${lines.length} lines total. Use git diff for full output.`);
        } else {
          console.log(detail);
        }
      } catch { /* skip */ }
    }

    log('🔄', t('nextRound'));
  }

  // ── HTML Report ──
  const meta = {
    date: new Date().toLocaleString(),
    model,
    mode: dryRun ? 'dry-run' : 'fix',
    extra: `Rounds: ${round}`,
    threshold,
  };
  const reportPath = writeReport({ review: lastReview, meta, outputDir: config.report.outputDir, open: config.report.open });
  log('📄', t('reportGenerated', reportPath));

  // ── Test generation (dry-run always, fix only if passed) ──
  const shouldGenTests = dryRun ? !noTest : (passed && !noTest);
  if (shouldGenTests) {
    separator(`🧪 ${t('testTitle')}`);
    const files = getChangedFiles({ file });
    if (files.length > 0) {
      log('📂', t('testTarget', files.join(', ')));
      const testResult = await generateTests({ files, env, model, config });
      console.log('\n' + testResult);
    } else {
      log('ℹ️', t('testNoFiles'));
    }
  }

  // ── Auto commit (fix mode + passed + not dry-run) ──
  if (passed && !noCommit && !dryRun) {
    separator(`📦 ${t('commitTitle')}`);
    try {
      execSync('git add -A', { encoding: 'utf-8' });
      const msg = `refactor: AI pipeline auto-fix (score: ${lastReview.score})`;
      execSync(`git commit -m "${msg}"`, { encoding: 'utf-8' });
      log('✅', t('commitDone', msg));
    } catch (e) {
      log('⚠️', t('commitFail', e.message?.split('\n')[0]));
    }
  }

  // ── Final report ──
  separator('📋 Pipeline Report');
  const modeReport = dryRun ? 'Dry-run' : 'Fix';
  log(passed || dryRun ? '✅' : '❌',
    `${dryRun ? t('resultDryRun') : passed ? t('resultPass') : t('resultFail')}`);
  log('📊', t('finalScore', lastReview.score));
  log('🔄', t('finalRounds', round));
  log('👁️', t('mode', modeReport));
  log('📄', t('finalReport', reportPath));

  if (dryRun) {
    log('💡', t('dryRunDone'));
    log('💡', t('fixSuggest'));
  } else if (!passed) {
    log('💡', t('manualSuggest'));
  }

  if (!passed && !dryRun) process.exit(1);
}
