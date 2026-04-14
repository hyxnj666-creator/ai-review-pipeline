/**
 * Review utilities — shared by pipeline.mjs and test.mjs
 * buildPrompt: constructs the AI review prompt from diff + custom rules
 * parseReview: extracts structured review data from AI response
 */

export function buildSystemPrompt(customRules) {
  const rulesStr = customRules.length
    ? '\n## 项目自定义规则（必须检查）\n' + customRules.map((r, i) => `${i + 1}. ${r}`).join('\n')
    : '';

  return `你是一个资深代码审查员。请对用户提供的 git diff 做 Code Review。

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

无问题则 score 为 100，issues 为空数组。`;
}

export function buildPrompt(diff) {
  return `请审查以下代码变更：

\`\`\`diff
${diff}
\`\`\``;
}

export function parseReview(content) {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
  if (!jsonMatch) {
    return { markdown: content, score: 0, red: 0, yellow: 0, green: 0, summary: 'AI 未返回结构化 JSON，无法判定质量', issues: [], parseError: true };
  }
  try {
    const result = JSON.parse(jsonMatch[1]);
    return { markdown: content, ...result, parseError: false };
  } catch {
    return { markdown: content, score: 0, red: 0, yellow: 0, green: 0, summary: 'JSON 解析失败，无法判定质量', issues: [], parseError: true };
  }
}
