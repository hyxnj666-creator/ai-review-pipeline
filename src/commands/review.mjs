import { loadEnv } from '../core/env.mjs';
import { loadConfig, getEnvConfig } from '../core/config.mjs';
import { initProxy, callAI } from '../core/ai-client.mjs';
import { getDiff } from '../core/diff.mjs';
import { writeReport } from '../core/report.mjs';
import { log, separator, t } from '../core/logger.mjs';

function buildPrompt(diff, customRules) {
  const rulesStr = customRules.length
    ? '\n## 项目自定义规则（必须检查）\n' + customRules.map((r, i) => `${i + 1}. ${r}`).join('\n')
    : '';

  return `你是一个资深代码审查员。请对以下 git diff 做 Code Review。

## 审查维度
1. **🔴 必修（阻塞合并）** — 逻辑错误、安全漏洞（XSS/注入/敏感信息泄露）、数据风险（并发/金额精度/状态流转错误）
2. **🟡 建议（应该修复）** — 边界未处理（空值/undefined/超时/重复提交）、类型问题（any/as 断言）、错误处理缺失
3. **🟢 优化（后续改进）** — 代码重复、命名不清、性能隐患
${rulesStr}

## 输出格式

每个问题：
### [🔴/🟡/🟢] 问题标题
- **文件**: 文件路径
- **行号**: 大概行号
- **问题**: 具体描述
- **修复**: 修复方案或代码示例

最后**必须**输出如下 JSON 块（用于机器解析）：
\`\`\`json
{
  "score": <0-100 质量分>,
  "red": <🔴数量>,
  "yellow": <🟡数量>,
  "green": <🟢数量>,
  "summary": "<一句话总结>",
  "issues": [
    { "file": "<路径>", "line": <行号>, "severity": "red|yellow|green", "title": "<问题>", "desc": "<描述>", "fix": "<修复建议>" }
  ]
}
\`\`\`

无问题则 score 为 100，issues 为空数组。

## Git Diff

\`\`\`diff
${diff}
\`\`\``;
}

function parseReview(content) {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
  let result = { score: 100, red: 0, yellow: 0, green: 0, summary: '', issues: [] };
  if (jsonMatch) {
    try { result = JSON.parse(jsonMatch[1]); } catch { /* use default */ }
  }
  return { markdown: content, ...result };
}

export async function run(args) {
  loadEnv();
  const config = loadConfig();
  const env = getEnvConfig();
  const model = config.review.model || env.model;

  if (!env.apiKey) { console.error(`❌ ${t('noApiKey')}`); process.exit(1); }

  await initProxy(env.proxy);

  const dryRun = args.includes('--dry-run');
  const full = args.includes('--full');
  const noReport = args.includes('--no-report');
  const jsonOutput = args.includes('--json');
  const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
  const branch = args.includes('--branch') ? args[args.indexOf('--branch') + 1] : null;
  const staged = args.includes('--staged');

  let diffLabel = 'staged changes';
  if (file && full) diffLabel = `${file} (full)`;
  else if (file) diffLabel = file;
  else if (branch) diffLabel = `branch vs ${branch}`;

  let diff = getDiff({ file, branch, staged, full });
  if (!diff.trim()) {
    if (jsonOutput) { process.stdout.write(JSON.stringify({ score: 100, red: 0, yellow: 0, green: 0, issues: [] })); }
    else { console.log(`✅ ${t('noChanges')}`); }
    process.exit(0);
  }

  const totalLines = diff.split('\n').length;
  let truncated = false;
  if (totalLines > config.review.maxDiffLines) {
    diff = diff.split('\n').slice(0, config.review.maxDiffLines).join('\n') + '\n... (truncated)';
    truncated = true;
  }

  if (!jsonOutput) {
    console.log(`📝 ${t('diffLines', totalLines, diffLabel, truncated)}`);
    console.log(`⚙️  ${t('provider', env.provider)} | ${t('model', model)} | ${t('threshold', config.review.threshold)}`);
  }

  const t0 = Date.now();
  const prompt = buildPrompt(diff, config.review.customRules || []);
  const { content, tokens } = await callAI({ baseUrl: env.baseUrl, apiKey: env.apiKey, model, prompt, provider: env.provider });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const review = parseReview(content);

  const meta = {
    date: new Date().toLocaleString(),
    model,
    diffLabel,
    totalLines,
    truncated,
    threshold: config.review.threshold,
    elapsed,
    tokens,
    mode: dryRun ? 'review (dry-run)' : 'review',
  };

  if (jsonOutput) {
    process.stdout.write(JSON.stringify({ ...review, meta }, null, 2));
    process.exit(dryRun ? 0 : (review.red > 0 ? 1 : 0));
  }

  separator(t('reviewTitle'));
  console.log(content);
  console.log();
  console.log('─'.repeat(60));
  log('📊', t('score', review.score, review.red, review.yellow, review.green));
  log('⏱️', `${t('model', model)} | ${t('reviewTime', elapsed)}${tokens ? ` | ${t('tokens', tokens.prompt_tokens, tokens.completion_tokens, tokens.total_tokens)}` : ''}`);
  log(review.score >= config.review.threshold && review.red === 0 ? '✅' : '❌',
    t('reviewResult', review.score >= config.review.threshold && review.red === 0));
  console.log('═'.repeat(60));

  if (!noReport) {
    const reportPath = writeReport({ review, meta, outputDir: config.report.outputDir, open: config.report.open });
    log('📄', t('reportGenerated', reportPath));
  }

  if (dryRun) {
    log('✅', t('resultDryRun'));
    log('💡', t('dryRunDone'));
    process.exit(0);
  }

  if (review.red > 0) process.exit(1);
}

export { buildPrompt, parseReview };
