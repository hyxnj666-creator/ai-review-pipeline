import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { loadEnv } from '../core/env.mjs';
import { loadConfig, getEnvConfig } from '../core/config.mjs';
import { initProxy, callAI } from '../core/ai-client.mjs';
import { getDiff, getChangedFiles, setIgnorePatterns } from '../core/diff.mjs';
import { runRuleChecks } from '../core/rule-checker.mjs';
import { writeReport } from '../core/report.mjs';
import { log, separator, t, getLang } from '../core/logger.mjs';
import { buildSourceFromFiles, runAiTestPipeline } from '../core/test-executor.mjs';
import { buildSystemPrompt, buildPrompt, parseReview } from './review.mjs';

// ─── Chunk splitting & merging ───
function splitDiffByFile(diff, maxLines) {
  const fileDiffs = [];
  let current = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ') && current.length > 0) {
      fileDiffs.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) fileDiffs.push(current.join('\n'));
  if (fileDiffs.length <= 1) return [diff.split('\n').slice(0, maxLines).join('\n')];

  const chunks = [];
  let chunk = [];
  let lineCount = 0;
  for (const fd of fileDiffs) {
    const lines = fd.split('\n').length;
    if (lineCount + lines > maxLines && chunk.length > 0) {
      chunks.push(chunk.join('\n'));
      chunk = [];
      lineCount = 0;
    }
    chunk.push(fd);
    lineCount += lines;
  }
  if (chunk.length > 0) chunks.push(chunk.join('\n'));
  return chunks;
}

function mergeReviews(results) {
  const summaries = [];
  const markdowns = [];
  const allIssues = [];
  const seen = new Set();
  for (const r of results) {
    for (const issue of (r.issues || [])) {
      const key = `${issue.severity || ''}::${issue.file || ''}::${issue.title || ''}::${issue.code || ''}::${issue.line || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allIssues.push(issue);
    }
    if (r.summary) summaries.push(r.summary);
    if (r.markdown) markdowns.push(r.markdown);
  }
  const totalRed = allIssues.filter((issue) => issue.severity === 'red').length;
  const totalYellow = allIssues.filter((issue) => issue.severity === 'yellow').length;
  const totalGreen = allIssues.filter((issue) => issue.severity === 'green').length;
  const totalBlue = allIssues.filter((issue) => issue.severity === 'blue').length;
  const score = Math.max(0, 100 - totalRed * 20 - totalYellow * 5 - totalGreen * 1);
  return {
    score, red: totalRed, yellow: totalYellow, green: totalGreen, blue: totalBlue,
    issues: allIssues,
    summary: [...new Set(summaries)].join('; ') || '',
    markdown: markdowns.join('\n\n---\n\n'),
    parseError: false,
  };
}

// ─── Auto Fix (single file) ───
async function fixFile({ filePath, issues, env, model, safetyMinRatio, temperature, maxTokens }) {
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

  const { content } = await callAI({ baseUrl: env.baseUrl, apiKey: env.apiKey, model, prompt, temperature, maxTokens, provider: env.provider });
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
async function autoFix({ issues, skipLevels, env, model, safetyMinRatio, temperature, maxTokens }) {
  const fileMap = new Map();
  for (const issue of issues) {
    if (!issue.file) continue;
    if (skipLevels.has(issue.severity)) continue;
    if (issue.severity === 'green' && !skipLevels.has('none')) continue;
    if (issue.severity === 'blue') continue;
    if (!fileMap.has(issue.file)) fileMap.set(issue.file, []);
    fileMap.get(issue.file).push(issue);
  }
  if (fileMap.size === 0) return { fixedCount: 0, fixedFiles: [] };

  let fixedCount = 0;
  const fixedFiles = [];
  for (const [file, fileIssues] of fileMap) {
    log('🔧', t('fixFile', file, fileIssues.length));
    const ok = await fixFile({ filePath: file, issues: fileIssues, env, model, safetyMinRatio, temperature, maxTokens });
    if (ok) { fixedCount++; fixedFiles.push(file); log('✅', t('fixDone', file)); }
    else { log('⚠️', t('fixFail', file)); }
  }
  return { fixedCount, fixedFiles };
}

// ─── Unified Pipeline ───
export async function run(args) {
  loadEnv();
  const config = loadConfig();
  const env = getEnvConfig();
  const cliModel = args.includes('--model') ? args[args.indexOf('--model') + 1] : '';
  const ignoreConfigModelForBuiltinFallback = env.builtinFallback && !cliModel && !process.env.AI_REVIEW_MODEL;
  const configModel = ignoreConfigModelForBuiltinFallback ? '' : config.review.model;
  const model = cliModel || configModel || env.model;
  const reviewTemperature = Number(config.review.temperature ?? 0.1);
  const reviewMaxTokens = Number(config.review.maxTokens ?? 8192);
  const fixTemperature = Number(config.fix.temperature ?? 0.2);
  const fixMaxTokens = Number(config.fix.maxTokens ?? 8192);
  const enableRules = config.review.enableRules !== false;

  if (!env.apiKey && env.provider !== 'ollama') { console.error(`❌ ${t('noApiKey')}`); process.exit(1); }
  if (env.builtinFallback) log('💡', t('builtinFallback'));
  if (env.ignoredModelOverride) log('⚠️', t('builtinFallbackIgnoreModel', env.requestedModel));
  if (ignoreConfigModelForBuiltinFallback && config.review.model) log('⚠️', t('builtinFallbackIgnoreConfigModel', config.review.model));

  await initProxy(env.proxy);
  setIgnorePatterns(config.ignore);

  // ── Parse args ──
  const fixMode = args.includes('--fix');
  const full = args.includes('--full');
  const noCommit = args.includes('--no-commit');
  const noTest = args.includes('--no-test') || config.test.enabled === false;
  const runTests = args.includes('--run-tests') || (!args.includes('--no-run-tests') && config.test.run !== false);
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
  let lastReview = { score: 0, red: 0, yellow: 0, green: 0, blue: 0, summary: '', issues: [], markdown: '' };
  let prevScore = null;
  let passed = false;
  let reviewTokens = null;
  const effectiveMaxRounds = fixMode ? maxRounds : 1;
  const allFixedFiles = [];
  const lang = getLang();
  const systemPrompt = buildSystemPrompt(config.review.customRules || [], lang);

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
    if (!jsonOutput) log('📏', `${totalLines} lines`);

    const t0 = Date.now();

    if (totalLines > config.review.maxDiffLines) {
      // Split by file and review in chunks
      const chunks = splitDiffByFile(diff, config.review.maxDiffLines);
      if (!jsonOutput) log('📦', t('chunkReview', chunks.length));

      const chunkResults = [];
      let totalPrompt = 0, totalCompletion = 0;
      for (let ci = 0; ci < chunks.length; ci++) {
        if (!jsonOutput) log('📝', t('chunkProgress', ci + 1, chunks.length));
        const chunkPrompt = buildPrompt(chunks[ci], lang);
        const useStream = !jsonOutput;
        if (useStream) process.stdout.write('\n');
        const { content: chunkContent, tokens: chunkTokens } = await callAI({
          baseUrl: env.baseUrl, apiKey: env.apiKey, model, systemPrompt, prompt: chunkPrompt,
          provider: env.provider, temperature: reviewTemperature, maxTokens: reviewMaxTokens, stream: useStream,
          onToken: useStream ? (tok) => process.stdout.write(tok) : undefined,
        });
        if (useStream) process.stdout.write('\n');
        const aiReview = parseReview(chunkContent);
        const ruleReview = enableRules ? runRuleChecks(chunks[ci], lang) : null;
        chunkResults.push(ruleReview ? mergeReviews([aiReview, ruleReview]) : aiReview);
        if (chunkTokens) {
          totalPrompt += chunkTokens.prompt_tokens || 0;
          totalCompletion += chunkTokens.completion_tokens || 0;
        }
      }
      lastReview = mergeReviews(chunkResults);
      reviewTokens = { prompt_tokens: totalPrompt, completion_tokens: totalCompletion, total_tokens: totalPrompt + totalCompletion };
    } else {
      const prompt = buildPrompt(diff, lang);
      const useStream = !jsonOutput;
      if (useStream) process.stdout.write('\n');
      const { content, tokens } = await callAI({
        baseUrl: env.baseUrl, apiKey: env.apiKey, model, systemPrompt, prompt,
        provider: env.provider, temperature: reviewTemperature, maxTokens: reviewMaxTokens, stream: useStream,
        onToken: useStream ? (tok) => process.stdout.write(tok) : undefined,
      });
      if (useStream) process.stdout.write('\n');
      reviewTokens = tokens;
      const aiReview = parseReview(content);
      const ruleReview = enableRules ? runRuleChecks(diff, lang) : null;
      lastReview = ruleReview ? mergeReviews([aiReview, ruleReview]) : aiReview;
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    if (!jsonOutput) {
      console.log();
      let scoreText = t('score', lastReview.score, lastReview.red, lastReview.yellow, lastReview.green, lastReview.blue || 0);
      if (prevScore !== null) {
        const delta = lastReview.score - prevScore;
        scoreText += delta > 0 ? ` (↑${delta})` : delta < 0 ? ` (↓${Math.abs(delta)})` : ' (→)';
      }
      log('📊', scoreText);
      log('⏱️', `${t('model', model)} | ${t('reviewTime', elapsed)}${reviewTokens ? ` | ${t('tokens', reviewTokens.prompt_tokens, reviewTokens.completion_tokens, reviewTokens.total_tokens)}` : ''}`);
      log('💬', lastReview.summary);
    }
    prevScore = lastReview.score;

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

    const fixableIssues = lastReview.issues.filter((i) => i.severity !== 'green' && i.severity !== 'blue');
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
      temperature: fixTemperature,
      maxTokens: fixMaxTokens,
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
  let testResult = null;
  if (!noTest) {
    separator(`🧪 ${t('testTitle')}`);
    const files = getChangedFiles({ file, staged, full });
    if (files.length > 0) {
      log('📂', t('testTarget', files.join(', ')));
      const prepared = buildSourceFromFiles(files, { maxLinesPerFile: 200 });
      if (prepared.sourceCode.trim()) {
        testResult = await runAiTestPipeline({
          sourceCode: prepared.sourceCode,
          fileLabel: prepared.fileLabel,
          targetFiles: prepared.files,
          env,
          model,
          config,
          lang,
          runTests,
        });
        console.log('\n' + testResult.output);
        console.log();
        if (testResult.execution.attempted) {
          log(testResult.execution.passed ? '✅' : '❌', t('testExecStatus', testResult.execution.passed ? t('testExecPassed') : t('testExecFailed')));
          log('🧪', t('testExecRunner', testResult.execution.runner, testResult.execution.elapsedMs));
          if (testResult.execution.tempFile) log('📄', t('testExecTempFile', testResult.execution.tempFile, testResult.execution.keptFile));
          if (!testResult.execution.passed) {
            if (testResult.execution.reason) log('⚠️', testResult.execution.reason);
            if (testResult.execution.stdout) console.log(`\n[stdout]\n${testResult.execution.stdout}`);
            if (testResult.execution.stderr) console.log(`\n[stderr]\n${testResult.execution.stderr}`);
          }
        } else {
          log('ℹ️', t('testExecSkipped', testResult.execution.reason));
        }
      } else {
        log('ℹ️', t('testNoFiles'));
      }
    } else {
      log('ℹ️', t('testNoFiles'));
    }
  }

  // ── Phase 3: Report (always, unless --no-report) ──
  let reportPath = '';
  const testPassed = !testResult?.execution?.attempted || testResult.execution.passed;
  const pipelinePassed = passed && testPassed;
  if (!noReport) {
    const meta = {
      date: new Date().toLocaleString(),
      model,
      mode: fixMode ? 'fix' : 'review',
      extra: fixMode ? `Rounds: ${round}/${maxRounds}${passed ? ' ✅' : ' ⚠️'}` : '',
      threshold,
    };
    reportPath = writeReport({ review: lastReview, meta, test: testResult, outputDir: config.report.outputDir, open: config.report.open });
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
  log(pipelinePassed ? '✅' : '❌', pipelinePassed ? t('resultPass') : t('resultFail'));
  log('📊', t('finalScore', lastReview.score));
  if (fixMode) log('🔄', t('finalRounds', round));
  log('👁️', t('mode', fixMode ? 'Fix' : 'Review'));
  if (testResult?.execution?.attempted) {
    log(testResult.execution.passed ? '✅' : '⚠️', t('testExecStatus', testResult.execution.passed ? t('testExecPassed') : t('testExecFailed')));
  } else if (testResult?.execution?.reason) {
    log('ℹ️', t('testExecSkipped', testResult.execution.reason));
  }
  if (reportPath) log('📄', t('finalReport', reportPath));

  if (!fixMode && !passed) {
    log('💡', t('fixSuggest'));
  } else if (fixMode && !passed) {
    log('💡', t('manualSuggest'));
  } else if (passed && !testPassed) {
    log('💡', t('testExecFixSuggest'));
  }

  // Exit: review or real test execution failed → exit(1)
  if (!pipelinePassed) process.exit(1);
}
