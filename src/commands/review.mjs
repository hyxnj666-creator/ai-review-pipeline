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
3. **🟢 Improvement (minor but real quality issue)** — Repeated logic that increases maintenance cost, weak abstractions, risky hardcoding, complex branches hurting readability, maintainability debt worth tracking
4. **🔵 Suggestion (non-scoring)** — Nice-to-have refactors, naming polish, optional extraction, style tidying, comment suggestions, other low-priority improvements
${rulesStr}

## Important Rules
- CSS class names, Tailwind utilities (e.g. gap-1.5, text-2xl, p-4, rounded-lg) are NOT magic numbers
- Prioritize real runtime and business risk: null-safety, async failures, invalid assumptions about data shape, broken conditions, unsafe rendering, state/data flow mistakes
- Prefer correctness and coverage for 🔴 / 🟡 issues. Do not omit meaningful logic, null-safety, async, security, or data-flow issues just to keep output short
- Only merge issues when they are the SAME type of problem in the SAME file. If merged, mention "similar issues in X other locations" in the description
- Keep 🟢 issues selective. Report at most 3 high-value improvement issues, and skip low-value noise
- Put low-priority refactor/naming/style suggestions into 🔵 instead of 🟢
- Do not report trivial style-only issues unless they clearly hurt readability or maintainability
- In React/JSX, plain \`{value}\` text rendering is escaped by default and is NOT XSS by itself. Only report XSS when there is an actual unsafe sink such as \`dangerouslySetInnerHTML\`, \`innerHTML\`, \`outerHTML\`, untrusted URL/protocol injection, or equivalent unsafe rendering

## Scoring

Base score: 100. Deductions:
- Each 🔴 issue: **-20 points**
- Each 🟡 issue: **-5 points**
- Each 🟢 issue: **-1 point**
- Each 🔵 issue: **0 points** (show as suggestion only, do not affect score)
- Minimum 0, never negative
- Calculate score strictly by this formula

## Output Format

You **must** output the following JSON block at the end (for machine parsing):
\`\`\`json
{
  "score": <0-100 quality score>,
  "red": <🔴 count>,
  "yellow": <🟡 count>,
  "green": <🟢 count>,
  "blue": <🔵 count>,
  "summary": "<one-line summary>",
  "issues": [
    { "file": "<path>", "line": <line>, "severity": "red|yellow|green|blue", "title": "<issue>", "desc": "<description>", "fix": "<fix suggestion>", "code": "<1-3 lines of the actual problematic source code>" }
  ]
}
\`\`\`

The "code" field must contain the **actual source code** that has the problem (copy from the diff), NOT the full diff. Keep it to 1-3 key lines only.
Keep \`desc\` and \`fix\` concise, but do not sacrifice important findings.

If no issues, score is 100 and issues is an empty array.`;
  }

  const rulesStr = customRules.length
    ? '\n## 项目自定义规则（必须检查）\n' + customRules.map((r, i) => `${i + 1}. ${r}`).join('\n')
    : '';

  return `你是一个资深代码审查员。请对用户提供的 git diff 做 Code Review。

## 审查维度
1. **🔴 必修（阻塞合并）** — 逻辑错误、安全漏洞（XSS/注入/敏感信息泄露）、数据风险（并发/金额精度/状态流转错误）、未捕获的异步错误（async 无 try-catch / Promise 无 .catch 导致崩溃或静默失败）、资源泄漏或死循环
2. **🟡 建议（应该修复）** — 边界未处理（空值/undefined/超时/重复提交）、类型问题（any/as 断言）、错误处理缺失（仅影响体验，不涉及数据丢失或安全；若可能造成数据丢失或安全问题则应升级为 🔴）
3. **🟢 优化（轻度但真实的质量问题）** — 会增加维护成本的重复逻辑、抽象薄弱、风险较高的硬编码、复杂分支影响可读性、值得记录的维护性债务
4. **🔵 建议（不计分）** — 可选的重构、命名润色、样式整理、注释建议、其它低优先级优化点
${rulesStr}

## 重要规则
- CSS 类名、Tailwind 工具类（如 gap-1.5、text-2xl、p-4、rounded-lg）**不算**魔法数字
- 优先关注真实运行风险和业务风险：空值访问、异步失败、数据结构假设错误、条件分支错误、不安全渲染、状态/数据流问题
- 对 🔴 / 🟡 问题优先保证正确性和覆盖度，不要为了精简输出而漏掉有意义的逻辑、空值、异步、安全、数据流问题
- **只有在同一文件中的同一类问题完全重复时才合并**。若合并，请在描述中注明"其余 X 处类似"
- 🟢 问题保持克制，最多输出 3 个高价值优化项，跳过低价值噪音
- 低优先级的重构 / 命名 / 样式建议，请放到 🔵，不要放到 🟢
- 不要报告纯样式层面的琐碎问题，除非它确实影响可读性或可维护性
- 在 React/JSX 中，普通的 \`{value}\` 文本渲染默认会转义，**本身不算 XSS**。只有出现 \`dangerouslySetInnerHTML\`、\`innerHTML\`、\`outerHTML\`、不可信 URL/协议注入等真实不安全渲染时，才报告 XSS

## 评分规则

基础分 100，按以下规则扣分：
- 每个 🔴 问题：**-20 分**
- 每个 🟡 问题：**-5 分**
- 每个 🟢 问题：**-1 分**
- 每个 🔵 问题：**0 分**（仅作为建议展示，不计入评分）
- 最低 0 分，不能为负数
- 必须严格按此公式计算 score，不要自由估算

## 输出格式

最后**必须**输出如下 JSON 块（用于机器解析）：
\`\`\`json
{
  "score": <0-100 质量分，按评分规则计算>,
  "red": <🔴数量>,
  "yellow": <🟡数量>,
  "green": <🟢数量>,
  "blue": <🔵数量>,
  "summary": "<一句话总结>",
  "issues": [
    { "file": "<路径>", "line": <行号>, "severity": "red|yellow|green|blue", "title": "<问题>", "desc": "<描述>", "fix": "<修复建议>", "code": "<1-3 行有问题的实际源代码>" }
  ]
}
\`\`\`

"code" 字段必须是**实际有问题的源代码**（从 diff 中复制），不是描述，只保留 1-3 行关键代码。
\`desc\` 和 \`fix\` 保持精简，但不要因为精简而漏掉重要问题。

无问题则 score 为 100，issues 为空数组。`;
}

export function buildPrompt(diff, lang = 'zh') {
  const label = lang === 'en' ? 'Please review the following code changes:' : '请审查以下代码变更：';
  return `${label}

\`\`\`diff
${diff}
\`\`\``;
}

function calcScore(red, yellow, green, blue = 0) {
  return Math.max(0, 100 - red * 20 - yellow * 5 - green * 1);
}

function normalizeSeverity(severity) {
  const s = String(severity || '').trim().toLowerCase();
  if (s === 'red' || s === 'yellow' || s === 'green' || s === 'blue') return s;
  if (s.includes('红')) return 'red';
  if (s.includes('黄')) return 'yellow';
  if (s.includes('绿')) return 'green';
  if (s.includes('蓝') || s.includes('建议') || s.includes('suggest')) return 'blue';
  return 'green';
}

function isTailwindLikeCode(code) {
  const c = String(code || '');
  return (
    (/class(Name)?\s*=/.test(c) || /const\s+\w*class\w*\s*=|const\s+\w*Class\w*\s*=/.test(c)) &&
    /(text-|bg-|border-|gap-|px-|py-|pt-|pb-|mt-|mb-|ml-|mr-|w-\[|h-\[|rounded|flex|grid|items-|justify-|tracking-|leading-|shrink-|absolute|relative|top-\[|left-\[)/.test(c)
  );
}

function isLowValueGreen(issue) {
  if (issue.severity !== 'green') return false;
  const text = `${issue.title} ${issue.desc} ${issue.fix}`.toLowerCase();
  if (/命名不清|naming|注释|comment|代码重复|duplicate|硬编码|hardcod|magic number|魔法数字|重复的类名|class name/.test(text)) {
    if (isTailwindLikeCode(issue.code)) return true;
  }
  if (/纯样式|style only|样式问题/.test(text)) return true;
  return false;
}

function isLikelyFalsePositiveXss(issue) {
  const text = `${issue.title} ${issue.desc} ${issue.fix}`.toLowerCase();
  if (!/xss|script|注入/.test(text)) return false;
  const code = String(issue.code || '');
  if (!code) return false;
  if (/dangerouslysetinnerhtml|innerhtml|outerhtml|v-html|document\.write/i.test(code)) return false;
  return /<[^>]+>\{[^}]+\}<\/[^>]+>/.test(code);
}

function normalizeIssue(issue) {
  return {
    file: String(issue?.file || '').trim(),
    line: typeof issue?.line === 'number' || typeof issue?.line === 'string' ? issue.line : '',
    severity: normalizeSeverity(issue?.severity),
    title: String(issue?.title || '').trim(),
    desc: String(issue?.desc || '').trim(),
    fix: String(issue?.fix || '').trim(),
    code: String(issue?.code || '').trim(),
  };
}

function upgradeSuggestions(issue) {
  if (issue.severity !== 'green') return issue;
  const text = `${issue.title} ${issue.desc} ${issue.fix}`.toLowerCase();
  if (/命名不清|naming|注释|comment|类名常量|class name|style only|样式问题|命名建议|naming polish|提取常量|extract constant|抽个组件|extract component/.test(text)) {
    return { ...issue, severity: 'blue' };
  }
  if (isTailwindLikeCode(issue.code) && /硬编码|hardcod|magic number|魔法数字|重复的类名|duplicate/.test(text)) {
    return { ...issue, severity: 'blue' };
  }
  return issue;
}

function postProcessIssues(issues) {
  const normalized = (issues || []).map(normalizeIssue).map(upgradeSuggestions).filter((issue) => issue.title && issue.desc);
  const filtered = normalized.filter((issue) => !isLikelyFalsePositiveXss(issue) && !isLowValueGreen(issue));
  const deduped = [];
  const seen = new Set();
  for (const issue of filtered) {
    const key = `${issue.severity}::${issue.file}::${issue.title}::${issue.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(issue);
  }
  const greens = deduped.filter((issue) => issue.severity === 'green').slice(0, 3);
  const blues = deduped.filter((issue) => issue.severity === 'blue').slice(0, 5);
  const nonSuggestion = deduped.filter((issue) => issue.severity !== 'green' && issue.severity !== 'blue');
  return [...nonSuggestion, ...greens, ...blues];
}

export function parseReview(content) {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
  if (!jsonMatch) {
    return { markdown: content, score: 0, red: 0, yellow: 0, green: 0, blue: 0, summary: 'AI 未返回结构化 JSON，无法判定质量', issues: [], parseError: true };
  }
  try {
    const result = JSON.parse(jsonMatch[1]);
    result.issues = postProcessIssues(result.issues || []);
    const red = result.issues.filter((issue) => issue.severity === 'red').length;
    const yellow = result.issues.filter((issue) => issue.severity === 'yellow').length;
    const green = result.issues.filter((issue) => issue.severity === 'green').length;
    const blue = result.issues.filter((issue) => issue.severity === 'blue').length;
    result.red = red;
    result.yellow = yellow;
    result.green = green;
    result.blue = blue;
    result.score = calcScore(red, yellow, green, blue);
    return { markdown: content, ...result, parseError: false };
  } catch {
    return { markdown: content, score: 0, red: 0, yellow: 0, green: 0, blue: 0, summary: 'JSON 解析失败，无法判定质量', issues: [], parseError: true };
  }
}
