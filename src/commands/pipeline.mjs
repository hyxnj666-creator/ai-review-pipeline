import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { loadEnv } from '../core/env.mjs';
import { loadConfig, getEnvConfig } from '../core/config.mjs';
import { initProxy, callAI } from '../core/ai-client.mjs';
import { getDiff, getChangedFiles, setIgnorePatterns } from '../core/diff.mjs';
import { writeReport } from '../core/report.mjs';
import { log, separator, t } from '../core/logger.mjs';
import { buildSystemPrompt, buildPrompt, parseReview } from './review.mjs';

// ─── Auto Fix (single file) ───
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

  const { content } = await callAI({ baseUrl: env.baseUrl, apiKey: env.apiKey, model, prompt, temperature: 0.2, provider: env.provider });
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

// ─── Auto Fix (batch) ───
async function autoFix({ issues, skipLevels, env, model, safetyMinRatio }) {
  const fileMap = new Map();
  for (const issue of issues) {
    if (!issue.file) continue;
    if (skipLevels.has(issue.severity)) continue;
    if (issue.severity === 'green' && !skipLevels.has('none')) continue;
    if (!fileMap.has(issue.file)) fileMap.set(issue.file, []);
    fileMap.get(issue.file).push(issue);
  }
  if (fileMap.size === 0) return { fixedCount: 0, fixedFiles: [] };

  let fixedCount = 0;
  const fixedFiles = [];
  for (const [file, fileIssues] of fileMap) {
    log('🔧', t('fixFile', file, fileIssues.length));
    const ok = await fixFile({ filePath: file, issues: fileIssues, env, model, safetyMinRatio });
    if (ok) { fixedCount++; fixedFiles.push(file); log('✅', t('fixDone', file)); }
    else { log('⚠️', t('fixFail', file)); }
  }
  return { fixedCount, fixedFiles };
}

// ─── Test generation ───
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

  const { content, tokens } = await callAI({ baseUrl: env.baseUrl, apiKey: env.apiKey, model, prompt, temperature: 0.4, provider: env.provider });
  log('📊', `Test Tokens: ${tokens?.total_tokens || 'N/A'}`);
  return content;
}

// ─── Unified Pipeline ───
export async function run(args) {
  loadEnv();
  const config = loadConfig();
  const env = getEnvConfig();
  const cliModel = args.includes('--model') ? args[args.indexOf('--model') + 1] : '';
  const model = cliModel || config.review.model || env.model;

  if (!env.apiKey && env.provider !== 'ollama') { console.error(`❌ ${t('noApiKey')}`); process.exit(1); }

  await initProxy(env.proxy);
  setIgnorePatterns(config.ignore);

  // ── Parse args ──
  const fixMode = args.includes('--fix');
  const full = args.includes('--full');
  const noCommit = args.includes('--no-commit');
  const noTest = args.includes('--no-test') || config.test.enabled === false;
  const noReport = args.includes('--no-report');
  const jsonOutput = args.includes('--json');
  const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
  const branch = args.includes('--branch') ? args[args.indexOf('--branch') + 1] : null;
  const staged = args.includes('--staged');
  const maxRounds = Number(args.includes('--max-rounds') ? args[args.indexOf('--max-rounds') + 1] : 0) || config.review.maxRounds;
  const threshold = Number(args.includes('--threshold') ? args[args.indexOf('--threshold') + 1] : 0) || config.review.threshold;
  const cliSkip = args.includes('--skip') ? (args[args.indexOf('--skip') + 1] || '') : '';
  const configSkip = (config.review.skip || []).join(',');
  const mergedSkip = [cliSkip, configSkip].filter(Boolean).join(',');
  const skipLevels = new Set(
    mergedSkip.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  );

  const modeLabel = fixMode ? t('modeFix') : t('modeReview');

  if (!jsonOutput) {
    separator(`🚀 ${t('pipelineTitle')}`);
    log('⚙️', t('mode', modeLabel));
    if (file) log('📂', t('target', full ? `${file} (full)` : file));
    log('⚙️', `${t('provider', env.provider)} | ${t('model', model)} | ${t('threshold', threshold)}${fixMode ? ` | ${t('maxRounds', maxRounds)}` : ''}`);
    if (fixMode) {
      log('⚙️', `${t('autoCommit', !noCommit)} | ${t('autoTest', !noTest)}`);
    }
  }

  // ── Phase 1: Review (+ Fix loop if --fix) ──
  let round = 0;
  let lastReview = { score: 0, red: 0, yellow: 0, green: 0, summary: '', issues: [], markdown: '' };
  let passed = false;
  let reviewTokens = null;
  const effectiveMaxRounds = fixMode ? maxRounds : 1;
  const allFixedFiles = [];
  const systemPrompt = buildSystemPrompt(config.review.customRules || []);

  while (round < effectiveMaxRounds) {
    round++;

    if (!jsonOutput) separator(`📝 ${t('roundTitle', round)}`);

    const diff = getDiff({ file, branch, staged, full });
    if (!diff.trim()) {
      if (!jsonOutput) log('✅', t('noChanges'));
      passed = true;
      break;
    }

    const totalLines = diff.split('\n').length;
    const truncated = totalLines > config.review.maxDiffLines
      ? diff.split('\n').slice(0, config.review.maxDiffLines).join('\n') + '\n... (truncated)'
      : diff;

    if (!jsonOutput) log('📏', `${totalLines} lines`);

    const t0 = Date.now();
    const prompt = buildPrompt(truncated);
    const { content, tokens } = await callAI({ baseUrl: env.baseUrl, apiKey: env.apiKey, model, systemPrompt, prompt, provider: env.provider });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    reviewTokens = tokens;

    lastReview = parseReview(content);

    if (!jsonOutput) {
      console.log('\n' + lastReview.markdown + '\n');
      log('📊', t('score', lastReview.score, lastReview.red, lastReview.yellow, lastReview.green));
      log('⏱️', `${t('model', model)} | ${t('reviewTime', elapsed)}${tokens ? ` | ${t('tokens', tokens.prompt_tokens, tokens.completion_tokens, tokens.total_tokens)}` : ''}`);
      log('💬', lastReview.summary);
    }

    const effectiveRed = skipLevels.has('red') ? 0 : lastReview.red;
    if (lastReview.score >= threshold && effectiveRed === 0) {
      if (!jsonOutput) log('🎉', t('passed', lastReview.score, threshold));
      passed = true;
      break;
    }

    // Default mode: 1 round review only, no fix
    if (!fixMode) break;

    // Fix mode: last round — only review, don't fix
    if (round >= maxRounds) {
      if (!jsonOutput) log('⚠️', t('maxRoundsReached', maxRounds));
      break;
    }

    // ── Auto Fix ──
    if (!jsonOutput) {
      separator(`🔧 ${t('fixRound', round)}`);
      log('⚠️', t('fixSafetyNote'));
    }

    const fixableIssues = lastReview.issues.filter((i) => i.severity !== 'green');
    if (fixableIssues.length === 0) {
      if (!jsonOutput) log('✅', t('noFixNeeded'));
      passed = true;
      break;
    }

    const { fixedCount, fixedFiles } = await autoFix({
      issues: fixableIssues,
      skipLevels,
      env,
      model,
      safetyMinRatio: config.fix.safetyMinRatio,
    });
    allFixedFiles.push(...fixedFiles);

    if (!jsonOutput) {
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
  }

  // ── JSON output mode: output and exit ──
  if (jsonOutput) {
    const result = {
      ...lastReview,
      passed,
      rounds: round,
      mode: fixMode ? 'fix' : 'review',
      meta: { model, threshold, tokens: reviewTokens },
    };
    process.stdout.write(JSON.stringify(result, null, 2));
    process.exit(passed ? 0 : 1);
  }

  // ── Phase 2: Test (always, unless --no-test) ──
  let testResult = '';
  if (!noTest) {
    separator(`🧪 ${t('testTitle')}`);
    const files = getChangedFiles({ file, staged, full });
    if (files.length > 0) {
      log('📂', t('testTarget', files.join(', ')));
      testResult = await generateTests({ files, env, model, config });
      console.log('\n' + testResult);
    } else {
      log('ℹ️', t('testNoFiles'));
    }
  }

  // ── Phase 3: Report (always, unless --no-report) ──
  let reportPath = '';
  if (!noReport) {
    const meta = {
      date: new Date().toLocaleString(),
      model,
      mode: fixMode ? 'fix' : 'review',
      extra: fixMode ? `Rounds: ${round}/${maxRounds}${passed ? ' ✅' : ' ⚠️'}` : '',
      threshold,
    };
    reportPath = writeReport({ review: lastReview, meta, outputDir: config.report.outputDir, open: config.report.open });
    log('📄', t('reportGenerated', reportPath));
  }

  // ── Phase 4: Auto Commit (fix mode + passed only) ──
  if (fixMode && passed && !noCommit && allFixedFiles.length > 0) {
    separator(`📦 ${t('commitTitle')}`);
    try {
      for (const f of allFixedFiles) {
        execSync(`git add -- "${f}"`, { encoding: 'utf-8' });
      }
      const msg = `refactor: AI pipeline auto-fix (score: ${lastReview.score})`;
      execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { encoding: 'utf-8' });
      log('✅', t('commitDone', msg));
    } catch (e) {
      log('⚠️', t('commitFail', e.message?.split('\n')[0]));
    }
  }

  // ── Final Summary ──
  separator('📋 Pipeline Report');
  log(passed ? '✅' : '❌', passed ? t('resultPass') : t('resultFail'));
  log('📊', t('finalScore', lastReview.score));
  if (fixMode) log('🔄', t('finalRounds', round));
  log('👁️', t('mode', fixMode ? 'Fix' : 'Review'));
  if (reportPath) log('📄', t('finalReport', reportPath));

  if (!fixMode && !passed) {
    log('💡', t('fixSuggest'));
  } else if (fixMode && !passed) {
    log('💡', t('manualSuggest'));
  }

  // Exit: not passed → exit(1)
  if (!passed) process.exit(1);
}
