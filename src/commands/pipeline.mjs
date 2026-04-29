import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { loadEnv } from '../core/env.mjs';
import { loadConfig, getEnvConfig } from '../core/config.mjs';
import { initProxy, callAI } from '../core/ai-client.mjs';
import { getDiff, getChangedFiles, setIgnorePatterns } from '../core/diff.mjs';
import { writeReport } from '../core/report.mjs';
import { runRuleChecks } from '../core/rule-checker.mjs';
import { log, separator, t, getLang } from '../core/logger.mjs';
import { buildSystemPrompt, buildPrompt, parseReview } from './review.mjs';

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

function recomputeCounts(issues) {
  let red = 0, yellow = 0, green = 0, blue = 0;
  for (const issue of issues) {
    if (issue.severity === 'red') red++;
    else if (issue.severity === 'yellow') yellow++;
    else if (issue.severity === 'green') green++;
    else if (issue.severity === 'blue') blue++;
  }
  const bluePenalty = Math.min(3, Math.max(0, blue - 5));
  const score = Math.max(0, 100 - red * 25 - yellow * 5 - green * 1 - bluePenalty);
  return { red, yellow, green, blue, score };
}

function evaluateGate(review, { threshold, maxMajor, skipLevels }) {
  const effectiveRed = skipLevels?.has('red') ? 0 : (review.red || 0);
  const effectiveYellow = skipLevels?.has('yellow') ? 0 : (review.yellow || 0);
  const reasons = [];
  if (review.parseError) reasons.push('parseError');
  if (effectiveRed > 0) {
    const cats = {};
    for (const issue of (review.issues || [])) {
      if (issue.severity !== 'red') continue;
      const cat = issue.category || 'unknown';
      cats[cat] = (cats[cat] || 0) + 1;
    }
    const detail = Object.entries(cats).map(([k, v]) => `${k}:${v}`).join(',');
    reasons.push(`blocker:${effectiveRed}(${detail})`);
  }
  if (effectiveYellow > maxMajor) reasons.push(`major:${effectiveYellow}>${maxMajor}`);
  if ((review.score || 0) < threshold) reasons.push(`score:${review.score}<${threshold}`);
  return { passed: reasons.length === 0, reasons };
}

function mergeRuleFindings(review, ruleResult, lang) {
  if (!ruleResult?.issues?.length) return review;
  const seen = new Set(
    (review.issues || []).map((issue) => `${issue.file || ''}::${issue.line || 0}::${issue.title || ''}`)
  );
  const mergedIssues = [...(review.issues || [])];
  for (const issue of ruleResult.issues) {
    const key = `${issue.file || ''}::${issue.line || 0}::${issue.title || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mergedIssues.push(issue);
  }
  const counts = recomputeCounts(mergedIssues);
  const ruleNote = lang === 'en'
    ? `Rule engine added ${ruleResult.issues.length} deterministic finding(s).`
    : `规则引擎补充了 ${ruleResult.issues.length} 个确定性问题。`;
  const summaryParts = [review.summary, ruleNote].filter(Boolean);
  return {
    ...review,
    issues: mergedIssues,
    red: counts.red,
    yellow: counts.yellow,
    green: counts.green,
    blue: counts.blue,
    score: counts.score,
    summary: summaryParts.join(' · '),
  };
}

function mergeReviews(results) {
  const allIssues = [];
  const summaries = [];
  const markdowns = [];
  let anyParseError = false;
  for (const r of results) {
    allIssues.push(...(r.issues || []));
    if (r.summary) summaries.push(r.summary);
    if (r.markdown) markdowns.push(r.markdown);
    if (r.parseError) anyParseError = true;
  }
  const counts = recomputeCounts(allIssues);
  return {
    score: counts.score,
    red: counts.red,
    yellow: counts.yellow,
    green: counts.green,
    blue: counts.blue,
    issues: allIssues,
    summary: summaries.join('; ') || '',
    markdown: markdowns.join('\n\n---\n\n'),
    parseError: anyParseError,
  };
}

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

async function autoFix({ issues, skipLevels, env, model, safetyMinRatio }) {
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
    const ok = await fixFile({ filePath: file, issues: fileIssues, env, model, safetyMinRatio });
    if (ok) { fixedCount++; fixedFiles.push(file); log('✅', t('fixDone', file)); }
    else { log('⚠️', t('fixFail', file)); }
  }
  return { fixedCount, fixedFiles };
}

async function generateTests({ files, env, model, config }) {
  const codeFiles = files.filter((f) => existsSync(resolve(process.cwd(), f)));
  if (codeFiles.length === 0) return { output: '', tokens: null };

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

  const { content, tokens } = await callAI({
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    model,
    prompt,
    temperature: config.test.temperature ?? 0.4,
    maxTokens: config.test.maxTokens,
    provider: env.provider,
  });
  log('📊', `Test Tokens: ${tokens?.total_tokens || 'N/A'}`);
  return { output: content, tokens, stack };
}

export async function run(args) {
  loadEnv();
  const config = loadConfig();
  const env = getEnvConfig();
  const cliModel = args.includes('--model') ? args[args.indexOf('--model') + 1] : '';
  const model = cliModel || config.review.model || env.model;

  if (!env.apiKey && env.provider !== 'ollama') { console.error(`❌ ${t('noApiKey')}`); process.exit(1); }
  if (env.builtinFallback) log('💡', t('builtinFallback'));

  await initProxy(env.proxy);
  setIgnorePatterns(config.ignore);

  const fixMode = args.includes('--fix');
  const full = args.includes('--full');
  const noCommit = args.includes('--no-commit');
  const noTest = args.includes('--no-test') || config.test.enabled === false || env.builtinFallback;
  const noReport = args.includes('--no-report');
  const jsonOutput = args.includes('--json');
  const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
  const branch = args.includes('--branch') ? args[args.indexOf('--branch') + 1] : null;
  const staged = args.includes('--staged');
  const maxRounds = Number(args.includes('--max-rounds') ? args[args.indexOf('--max-rounds') + 1] : 0) || config.review.maxRounds;
  const threshold = Number(args.includes('--threshold') ? args[args.indexOf('--threshold') + 1] : 0) || config.review.threshold;
  const maxMajor = Number(args.includes('--max-major') ? args[args.indexOf('--max-major') + 1] : NaN);
  const effectiveMaxMajor = Number.isFinite(maxMajor) ? maxMajor : (config.review.maxMajor ?? 3);
  const cliSkip = args.includes('--skip') ? (args[args.indexOf('--skip') + 1] || '') : '';
  const configSkip = (config.review.skip || []).join(',');
  const mergedSkip = [cliSkip, configSkip].filter(Boolean).join(',');
  const skipLevels = new Set(
    mergedSkip.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
  const rulesEnabled = config.review.enableRules !== false && !args.includes('--no-rules');

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
      const chunks = splitDiffByFile(diff, config.review.maxDiffLines);
      if (!jsonOutput) log('📦', t('chunkReview', chunks.length));

      const chunkResults = [];
      for (let ci = 0; ci < chunks.length; ci++) {
        if (!jsonOutput) log('📝', t('chunkProgress', ci + 1, chunks.length));
        const chunkPrompt = buildPrompt(chunks[ci], lang);
        const useStream = !jsonOutput;
        if (useStream) process.stdout.write('\n');
        const { content: chunkContent } = await callAI({
          baseUrl: env.baseUrl,
          apiKey: env.apiKey,
          model,
          systemPrompt,
          prompt: chunkPrompt,
          provider: env.provider,
          temperature: config.review.temperature,
          maxTokens: config.review.maxTokens,
          stream: useStream,
          onToken: useStream ? (tok) => process.stdout.write(tok) : undefined,
        });
        if (useStream) process.stdout.write('\n');
        chunkResults.push(parseReview(chunkContent));
      }
      lastReview = mergeReviews(chunkResults);
    } else {
      const prompt = buildPrompt(diff, lang);
      const useStream = !jsonOutput;
      if (useStream) process.stdout.write('\n');
      const { content, tokens } = await callAI({
        baseUrl: env.baseUrl,
        apiKey: env.apiKey,
        model,
        systemPrompt,
        prompt,
        provider: env.provider,
        temperature: config.review.temperature,
        maxTokens: config.review.maxTokens,
        stream: useStream,
        onToken: useStream ? (tok) => process.stdout.write(tok) : undefined,
      });
      if (useStream) process.stdout.write('\n');
      reviewTokens = tokens;
      lastReview = parseReview(content);
    }

    if (rulesEnabled) {
      const ruleResult = runRuleChecks(diff, lang);
      if (ruleResult.issues.length > 0) {
        lastReview = mergeRuleFindings(lastReview, ruleResult, lang);
        if (!jsonOutput) log('🧭', t('ruleEngineFound', ruleResult.issues.length));
      }
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
      if (lastReview.summary) log('💬', lastReview.summary);
    }
    prevScore = lastReview.score;

    const gate = evaluateGate(lastReview, { threshold, maxMajor: effectiveMaxMajor, skipLevels });
    if (gate.passed) {
      if (!jsonOutput) log('🎉', t('passed', lastReview.score, threshold));
      passed = true;
      break;
    }
    if (!jsonOutput && gate.reasons.length) {
      log('🚫', t('gateBlocked', gate.reasons.join(', ')));
    }

    if (!fixMode) break;

    if (round >= maxRounds) {
      if (!jsonOutput) log('⚠️', t('maxRoundsReached', maxRounds));
      break;
    }

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

  const finalGate = evaluateGate(lastReview, { threshold, maxMajor: effectiveMaxMajor, skipLevels });

  if (jsonOutput) {
    const result = {
      ...lastReview,
      passed,
      rounds: round,
      mode: fixMode ? 'fix' : 'review',
      gate: { passed: finalGate.passed, reasons: finalGate.reasons, threshold, maxMajor: effectiveMaxMajor },
      meta: { model, threshold, maxMajor: effectiveMaxMajor, tokens: reviewTokens },
    };
    process.stdout.write(JSON.stringify(result, null, 2));
    process.exit(passed ? 0 : 1);
  }

  let testBlock = null;
  if (!noTest) {
    separator(`🧪 ${t('testTitle')}`);
    const files = getChangedFiles({ file, staged, full });
    if (files.length > 0) {
      log('📂', t('testTarget', files.join(', ')));
      testBlock = await generateTests({ files, env, model, config });
      if (testBlock.output) console.log('\n' + testBlock.output);
    } else {
      log('ℹ️', t('testNoFiles'));
    }
  }

  let reportPath = '';
  if (!noReport) {
    const meta = {
      date: new Date().toLocaleString(),
      model,
      mode: fixMode ? 'fix' : 'review',
      extra: fixMode ? `Rounds: ${round}/${maxRounds}${passed ? ' ✅' : ' ⚠️'}` : '',
      threshold,
      maxMajor: effectiveMaxMajor,
      gate: finalGate,
    };
    reportPath = writeReport({
      review: lastReview,
      meta,
      test: testBlock,
      outputDir: config.report.outputDir,
      open: config.report.open,
    });
    log('📄', t('reportGenerated', reportPath));
  }

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

  separator('📋 Pipeline Report');
  log(passed ? '✅' : '❌', passed ? t('resultPass') : t('resultFail'));
  log('📊', t('finalScore', lastReview.score));
  log('🧪', t('finalCounts', lastReview.red || 0, lastReview.yellow || 0, lastReview.green || 0, lastReview.blue || 0));
  log('🎯', t('finalGate', threshold, effectiveMaxMajor));
  if (!passed && finalGate.reasons.length) {
    log('🚫', t('gateBlocked', finalGate.reasons.join(', ')));
  }
  if (fixMode) log('🔄', t('finalRounds', round));
  log('👁️', t('mode', fixMode ? 'Fix' : 'Review'));
  if (reportPath) log('📄', t('finalReport', reportPath));

  if (!fixMode && !passed) {
    log('💡', t('fixSuggest'));
  } else if (fixMode && !passed) {
    log('💡', t('manualSuggest'));
  }

  if (!passed) process.exit(1);
}
