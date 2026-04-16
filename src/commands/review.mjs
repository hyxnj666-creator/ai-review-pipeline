/**
 * Review utilities — shared by pipeline.mjs and test.mjs
 * buildPrompt: constructs the AI review prompt from diff + custom rules
 * parseReview: extracts structured review data from AI response
 */

export function buildSystemPrompt(customRules, lang = 'zh') {
  if (lang === 'en') {
    const rulesStr = customRules.length
      ? '\n## Project-specific Rules (must check)\n' + customRules.map((r, i) => `${i + 1}. ${r}`).join('\n')
      : '';

    return `You are a senior code reviewer. Review the git diff provided by the user.

## Review Dimensions
1. **🔴 Critical (blocks merge)** — Logic errors, security vulnerabilities (XSS/injection/sensitive data leak), data risks (concurrency/precision/state flow), uncaught async errors (async without try-catch / Promise without .catch), resource leaks or infinite loops
2. **🟡 Warning (should fix)** — Unhandled edge cases (null/undefined/timeout/duplicate submission), type issues (any/as assertion), missing error handling (UX-only; escalate to 🔴 if it may cause data loss or security risk)
3. **🟢 Info (improve later)** — Code duplication, unclear naming, perf hints, magic numbers/hardcoded strings, complex logic without comments, style inconsistency
${rulesStr}

## Scoring

Base score: 100. Deductions:
- Each 🔴 issue: **-20 points**
- Each 🟡 issue: **-5 points**
- Each 🟢 issue: **-1 point**
- Minimum 0, never negative
- Calculate score strictly by this formula

## Output Format

Per issue:
### [🔴/🟡/🟢] Issue title
- **File**: file path
- **Line**: approximate line number
- **Issue**: description
- **Fix**: fix suggestion or code example

You **must** output the following JSON block at the end (for machine parsing):
\`\`\`json
{
  "score": <0-100 quality score>,
  "red": <🔴 count>,
  "yellow": <🟡 count>,
  "green": <🟢 count>,
  "summary": "<one-line summary>",
  "issues": [
    { "file": "<path>", "line": <line>, "severity": "red|yellow|green", "title": "<issue>", "desc": "<description>", "fix": "<fix suggestion>" }
  ]
}
\`\`\`

If no issues, score is 100 and issues is an empty array.`;
  }

  const rulesStr = customRules.length
    ? '\n## 项目自定义规则（必须检查）\n' + customRules.map((r, i) => `${i + 1}. ${r}`).join('\n')
    : '';

  return `你是一个资深代码审查员。请对用户提供的 git diff 做 Code Review。

## 审查维度
1. **🔴 必修（阻塞合并）** — 逻辑错误、安全漏洞（XSS/注入/敏感信息泄露）、数据风险（并发/金额精度/状态流转错误）、未捕获的异步错误（async 无 try-catch / Promise 无 .catch 导致崩溃或静默失败）、资源泄漏或死循环
2. **🟡 建议（应该修复）** — 边界未处理（空值/undefined/超时/重复提交）、类型问题（any/as 断言）、错误处理缺失（仅影响体验，不涉及数据丢失或安全；若可能造成数据丢失或安全问题则应升级为 🔴）
3. **🟢 优化（后续改进）** — 代码重复、命名不清、性能隐患、魔法数字/硬编码字符串、复杂逻辑缺少注释、代码风格不一致
${rulesStr}

## 评分规则

基础分 100，按以下规则扣分：
- 每个 🔴 问题：**-20 分**
- 每个 🟡 问题：**-5 分**
- 每个 🟢 问题：**-1 分**
- 最低 0 分，不能为负数
- 必须严格按此公式计算 score，不要自由估算

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
  "score": <0-100 质量分，按评分规则计算>,
  "red": <🔴数量>,
  "yellow": <🟡数量>,
  "green": <🟢数量>,
  "summary": "<一句话总结>",
  "issues": [
    { "file": "<路径>", "line": <行号>, "severity": "red|yellow|green", "title": "<问题>", "desc": "<描述>", "fix": "<修复建议>" }
  ]
}
\`\`\`

无问题则 score 为 100，issues 为空数组。`;
}

export function buildPrompt(diff, lang = 'zh') {
  const label = lang === 'en' ? 'Please review the following code changes:' : '请审查以下代码变更：';
  return `${label}

\`\`\`diff
${diff}
\`\`\``;
}

function calcScore(red, yellow, green) {
  return Math.max(0, 100 - red * 20 - yellow * 5 - green * 1);
}

export function parseReview(content) {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
  if (!jsonMatch) {
    return { markdown: content, score: 0, red: 0, yellow: 0, green: 0, summary: 'AI 未返回结构化 JSON，无法判定质量', issues: [], parseError: true };
  }
  try {
    const result = JSON.parse(jsonMatch[1]);
    const red = result.red || 0;
    const yellow = result.yellow || 0;
    const green = result.green || 0;
    result.score = calcScore(red, yellow, green);
    return { markdown: content, ...result, parseError: false };
  } catch {
    return { markdown: content, score: 0, red: 0, yellow: 0, green: 0, summary: 'JSON 解析失败，无法判定质量', issues: [], parseError: true };
  }
}
