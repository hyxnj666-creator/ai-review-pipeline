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

    return `You are a senior code reviewer performing a commercial-grade review for an IT team. Your review gates merge/release. Be precise, practical, and conservative. Review the git diff provided by the user.

## Severity Model (strict, commercial)

### 🔴 Blocker — must fix before merge (-25 each; a single 🔴 BLOCKS merge)
Only use 🔴 for **concrete, provable production risks**. Pick one of the categories below, otherwise downgrade to 🟡.

**Security** — any of these is 🔴:
- XSS sinks with user-controlled content (\`dangerouslySetInnerHTML\`, \`innerHTML=\`, \`v-html\`, unsafe \`eval\`)
- Injection: SQL / NoSQL / OS command / template injection
- Hardcoded secrets in source (API key, token, password, private key, DB connection string)
- Missing auth / authorization on a sensitive operation; broken access control
- CSRF missing on a state-changing endpoint
- Sensitive data leakage (PII, password, token) to logs / storage / URL / client
- Insecure crypto for security purposes (MD5/SHA1, \`Math.random\` for tokens, predictable IV)
- Path traversal, SSRF, prototype pollution, unsafe deserialization

**Correctness (provable business impact)** — any of these is 🔴:
- Wrong business logic that changes a real outcome (money, permission, data integrity)
- Race condition on shared mutable state (no lock / no transaction)
- Float arithmetic for currency without proper rounding / Decimal
- Silent data loss: write error ignored, catch-and-swallow on DB/IO, missing await on critical write
- Broken invariants or violated contracts that a caller relies on
- Infinite loop / unbounded recursion / unbounded memory growth

**Stability** — any of these is 🔴:
- Unhandled promise rejection propagating to top level (not caught anywhere)
- Resource leak: DB connection / file handle / socket / subscription / event listener not released
- Clear memory leak pattern (growing array never cleared, listeners attached every render)

**Do NOT use 🔴 for:**
- Rendering a possibly-undefined value in JSX/template (frameworks render empty, no crash)
- "Could add optional chaining for safety" when current code is already safe
- Style, naming, duplication, defensive-coding suggestions
- Theoretical issues without a realistic input that triggers them

### 🟡 Major — should fix before release (-5 each; more than 3 BLOCKS merge)
Real issues that will hurt users or production, but are not proven blockers today.

- **Logic & edge cases**: unguarded null/undefined on method calls with realistic inputs, off-by-one, missing array bounds, missing duplicate-submit guard, missing idempotency on retryable actions
- **Input validation**: user-facing API / form without validation, trusting URL params or \`localStorage\` / API response as typed data
- **Error handling**: \`try\` that swallows the error silently, missing timeout on external calls, missing retry on flaky dependencies where it matters, error paths leaking stack traces to clients
- **Type safety**: \`any\` / \`as unknown as T\` / \`@ts-ignore\` / non-null \`!\` hiding a real risk, not a noise-level cast
- **Performance on hot path**: N+1 queries, O(n²) on a list that can realistically grow past ~100 items, unpaginated unbounded list, large sync blocking in UI thread, missing memo on a measurably expensive calc in a frequently re-rendered component. If the list is small and bounded (e.g. navigation items, form fields), downgrade to 🟢.
- **API contract**: incorrect status code, breaking change without version bump, leaking internals in response
- **UX degradation**: missing loading / error state on a **user-critical path** (checkout, login, payment, data submission). For internal admin pages or secondary features, downgrade to 🟢.

### 🟢 Minor — quality debt (-1 each; affects score only)
Real but non-blocking code-health issues.

- Duplicated **business logic** or utility function (not UI) across files
- **Business-logic** magic numbers: thresholds, retry counts, timeouts, ratios in computation
- Complex algorithm / non-obvious state machine lacking documentation
- Minor perf hints (memoization, avoidable re-render) where impact is real but small
- Dead code / unused exports (only when you can verify)
- Inconsistent error-handling pattern within the same module
- Missing loading/error state on non-critical or internal-only pages (downgraded from 🟡)

### 🔵 Info — suggestions (0 each individually; density penalty -1 per 🔵 over 5, cap -3)
Non-blocking, stylistic, or refactor ideas. Do not let 🔵 bloat.

- Duplicated **UI / JSX / styling config** (\`motion.div\`, \`className\`, \`<Card>\`, variants objects, animation config) — even 20 repeats belong here
- Naming preferences (\`d\` → \`resumeData\`)
- Style inconsistency, formatting
- Missing comments on ordinary code
- "Could use optional chaining here" when current code is safe
- "Could extract a reusable component" / pure refactor ideas
- The following numeric literals are **not** magic numbers and must not be reported: Tailwind / CSS utility values (\`text-[11px]\`, \`mt-3\`, \`gap-1.5\`), hex colors (\`#22d3ee\`), CSS units (px / rem / em / ms / % / vh / vw), framer-motion config, array indexes, version numbers, HTTP status constants.

## Severity Calibration (must follow)
- Default to a lower severity when uncertain. One mistaken 🔴 blocks a release.
- A realistic file has 0–1 🔴 and 0–3 🟡 in most reviews.
- Rendering \`{x.y}\` where \`y\` may be undefined is **at most 🟡** (crash only if something calls a method on it).
- UI / animation / styling repetition is **always 🔵**, no matter how many times.
- Before writing a 🔴, ask: "Can I describe the exact user-visible incident this would cause?" If not, downgrade.
- **Frontend vs Backend context**: Unhandled promise rejection in a Node.js/Deno server process may crash the process → 🔴. In a browser React/Vue component it is typically caught by ErrorBoundary or a global handler → at most 🟡.

## De-duplication (must follow)
- Same problem on many lines → report **once**, list at most the first 5 affected lines in "desc" (e.g. "lines 150, 220, 300").
- Use real line numbers from the provided diff/code. Do NOT invent line numbers beyond file length.
- **Total issues ≤ 10**. Prefer the most important ones; drop low-signal findings.
- **🔵 must be ≤ 5 total**. Merge all "duplicate component / style" findings into ONE issue titled "Duplicated UI patterns".
- If you're about to report the same pattern on more than ~10 lines, it's almost certainly a style/UI token — don't report it.
${rulesStr}

## Scoring (must compute strictly)

Base 100. Deductions:
- Each 🔴: **-25**
- Each 🟡: **-5**
- Each 🟢: **-1**
- 🔵 density: **0** if count ≤ 5; else **-1 per 🔵 over 5, capped at -3**
- Floor at 0 (never negative).

Gate (informational — host decides final pass/fail):
- Any 🔴 → BLOCK
- 🟡 > 3 → BLOCK
- score < threshold (host-provided) → BLOCK
- Otherwise → PASS

## Output Format

For each issue (prose block):
### [🔴/🟡/🟢/🔵] Title
- **File**: path
- **Line**: line number (or comma-separated list of ≤ 5 lines)
- **Category**: security | correctness | stability | logic | perf | types | api | ux | quality | style
- **Issue**: what it is and why it matters
- **Fix**: concrete fix or code example

Then **must** emit this machine-readable JSON at the end:
\`\`\`json
{
  "score": <0-100>,
  "red": <🔴 count>,
  "yellow": <🟡 count>,
  "green": <🟢 count>,
  "blue": <🔵 count>,
  "summary": "<one-line summary of the highest-priority concern>",
  "issues": [
    { "file": "<path>", "line": <number>, "severity": "red|yellow|green|blue", "category": "<category>", "title": "<title>", "desc": "<description>", "fix": "<fix>" }
  ]
}
\`\`\`

If nothing found, score is 100 and issues is an empty array.`;
  }

  const rulesStr = customRules.length
    ? '\n## 项目自定义规则（必须检查）\n' + customRules.map((r, i) => `${i + 1}. ${r}`).join('\n')
    : '';

  return `你是一位为 IT 团队做**商业级**代码审查的资深审查员。你的审查结果直接作为代码合并 / 发布的准入门禁，必须精准、可落地、保守。请对用户提供的 git diff 做 Code Review。

## 严重度模型（严格、商用标准）

### 🔴 阻塞（必须合并前修复；每个 -25 分；**任意一条即阻塞合并**）
🔴 只能用于**确凿的、可复现的生产级风险**。必须能对应到下列任一类别，否则降级到 🟡。

**安全类** — 任一条即 🔴：
- XSS 注入点：用户可控内容落入 \`dangerouslySetInnerHTML\` / \`innerHTML=\` / \`v-html\` / \`eval\`
- 注入漏洞：SQL / NoSQL / OS 命令 / 模板注入
- 硬编码敏感信息：API Key、Token、密码、私钥、数据库连接串出现在源码中
- 敏感操作缺鉴权 / 权限校验；越权访问
- 状态变更接口缺 CSRF 防护
- 敏感信息（密码、Token、PII）泄露到日志 / 存储 / URL / 前端
- 安全用途下使用不安全加密（MD5/SHA1、\`Math.random\` 做 Token、可预测 IV）
- 路径穿越、SSRF、原型污染、不安全反序列化

**正确性类（可证明业务影响）** — 任一条即 🔴：
- 会改变真实业务结果的逻辑错误（金额、权限、数据完整性）
- 共享可变状态上的竞态（缺锁 / 缺事务）
- 金额用浮点数算且未正确四舍五入 / 未用 Decimal
- 静默丢数据：写入错误被忽略、DB/IO 被 catch 吞掉、关键写入漏 \`await\`
- 违反调用方依赖的约束 / 不变式
- 死循环、无限递归、内存无界增长

**稳定性类** — 任一条即 🔴：
- Promise reject 冒到顶层且无人 catch
- 资源泄漏：DB 连接 / 文件句柄 / Socket / 订阅 / 事件监听器未释放
- 明显内存泄漏（持续增长的数组、每次渲染都 attach 监听器）

**不可以**用 🔴 的情况：
- JSX / 模板里渲染可能为 undefined 的字段（框架渲染空，不崩）
- "加可选链更稳妥"但当前代码本来就不会崩
- 风格、命名、重复代码、"可加防御式写法"之类的建议
- 没有现实输入能触发的理论风险

### 🟡 严重（发布前应修复；每个 -5 分；**超过 3 条即阻塞合并**）
真实的用户影响或生产风险，只是今天还不能 100% 定性为阻塞。

- **逻辑与边界**：真实输入下触发的 null/undefined 方法调用、off-by-one、数组越界、防重复提交缺失、可重试动作缺幂等
- **输入校验**：对外 API / 表单缺校验，把 URL 参数 / localStorage / 接口返回当可信数据直接用
- **错误处理**：\`try\` 吞异常、外部调用无超时、关键依赖无重试、错误响应泄露堆栈
- **类型安全**：\`any\` / \`as unknown as T\` / \`@ts-ignore\` / 非空断言 \`!\` 掩盖真实风险（不是噪音级 cast）
- **热路径性能**：N+1 查询、现实中列表可超百项时的 O(n²)、无分页的无界列表、UI 线程大同步阻塞、频繁重渲染组件里缺昂贵计算 memo。列表小且有界的（如导航项、表单字段）降为 🟢
- **API 契约**：状态码错误、破坏性变更无版本升级、响应泄露内部细节
- **UX 降级**：**用户关键路径**（结账、登录、支付、数据提交）缺 loading / 错误态。内部管理页或次要功能降为 🟢

### 🟢 次要（质量债务；每个 -1 分；仅影响分数）
真实但不阻塞的代码健康问题。

- 跨文件的**业务逻辑 / 工具函数**重复（不是 UI）
- **业务逻辑里**的魔法数字：阈值、重试次数、超时、计算比例
- 复杂算法 / 非直观状态机缺文档
- 真实但不大的性能优化（memoization、可避免的重渲染）
- 死代码 / 无用导出（仅当能验证）
- 同一模块内错误处理风格不一致
- 非关键路径 / 内部管理页缺 loading / 错误态（从 🟡 降级）

### 🔵 提示（可选建议；单条 0 分；密度扣分：>5 每条 -1，封顶 -3）
非阻塞的风格/重构建议，数量必须受控。

- **UI / JSX / 样式配置**重复（\`motion.div\`、\`className\`、\`<Card>\`、variants、动画配置）——重复 20 次也属于这档
- 命名偏好（\`d\` → \`resumeData\`）
- 风格不一致、格式化
- 普通代码缺注释
- "这里可加可选链"但当前代码已安全
- "可抽个公共组件" / 纯重构建议
- 以下数值**不算**魔法数字，不要报告它们：Tailwind / CSS 工具类数值（\`text-[11px]\`、\`mt-3\`、\`gap-1.5\`）、十六进制颜色（\`#22d3ee\`）、CSS 单位（px / rem / em / ms / % / vh / vw）、framer-motion 配置、数组下标、版本号、HTTP 状态码常量

## 严重度校准（必须遵守）
- 不确定时**往低走**。一条错误的 🔴 就拦住发布。
- 正常一个文件审查结果通常只有 0–1 个 🔴、0–3 个 🟡。
- 渲染 \`{x.y}\` 且 \`y\` 可能 undefined，**最多算 🟡**（除非后面真调了方法才会崩）。
- UI / 动画 / 样式重复**永远**是 🔵，不管多少次。
- 写 🔴 前问自己："我能清楚描述这条会导致哪个用户可见事故吗？"不能 → 降级。
- **前端 vs 后端上下文**：Promise reject 在 Node.js / Deno 服务端可能导致进程崩溃 → 🔴；在浏览器 React / Vue 组件中通常被 ErrorBoundary / 全局 handler 兜底 → 最多 🟡。

## 去重规则（必须遵守）
- 同一类问题多行命中 → 只报**一次**，desc 里最多列前 5 个受影响行号（例"行 150、220、300"）。
- 行号必须真实存在。**不要**编造超出文件长度的行号。
- **问题总数 ≤ 10 条**。优先报最重要的，信号弱的丢弃。
- **🔵 总数 ≤ 5 条**。多条"重复组件/样式"合并为一条，标题"重复的 UI 组件/样式 pattern"。
- 同一 pattern 要报到 10 行以上，基本是 UI token，**不该**报出来。
${rulesStr}

## 评分规则（必须严格计算）

基础分 100，扣分：
- 每个 🔴：**-25**
- 每个 🟡：**-5**
- 每个 🟢：**-1**
- 🔵 密度：总数 ≤ 5 → **0**；否则**每多 1 条 -1，封顶 -3**
- 最低 0 分，不能为负

准入门禁（信息性——最终 pass/fail 由宿主判定）：
- 任意 🔴 → BLOCK
- 🟡 > 3 → BLOCK
- 分数 < 宿主阈值 → BLOCK
- 否则 → PASS

## 输出格式

每个问题（prose 部分）：
### [🔴/🟡/🟢/🔵] 标题
- **文件**: 路径
- **行号**: 行号（或逗号分隔 ≤ 5 个）
- **类别**: security | correctness | stability | logic | perf | types | api | ux | quality | style
- **问题**: 是什么、为什么重要
- **修复**: 具体方案或代码示例

最后**必须**输出下列 JSON（机器解析用）：
\`\`\`json
{
  "score": <0-100，按规则计算>,
  "red": <🔴数量>,
  "yellow": <🟡数量>,
  "green": <🟢数量>,
  "blue": <🔵数量>,
  "summary": "<一句话总结最关键的一条>",
  "issues": [
    { "file": "<路径>", "line": <行号>, "severity": "red|yellow|green|blue", "category": "<类别>", "title": "<标题>", "desc": "<描述>", "fix": "<修复>" }
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

function calcScore(red, yellow, green, blue = 0) {
  const bluePenalty = Math.min(3, Math.max(0, blue - 5));
  return Math.max(0, 100 - red * 25 - yellow * 5 - green * 1 - bluePenalty);
}

const UI_STYLE_RE = /(?:重复的?|duplicat(?:e|ed|ion)|repeated?|冗余的?|相似的|相同的)\s*(?:.*?)?\s*(?:motion|card|classname|css|ui|jsx|样式|组件|variant|animation|styling|style|pattern|配置|使用|类名)/i;
const STYLE_ONLY_RE = /^(?:重复的?|duplicat(?:e|ed)|repeated?)\s*(motion|css|classname|card|variant|animation|配置|类名|样式|组件)/i;

function collapseSimilarIssues(issues) {
  const buckets = new Map();
  const out = [];
  for (const issue of issues) {
    const file = String(issue.file || '').trim();
    const severity = String(issue.severity || '').trim();
    const title = String(issue.title || '').trim();
    const prefixMatch = title.match(/^(重复的|重复|Duplicated?|Duplicate|Repeated|冗余的|冗余|相似的|相同的)[\s\S]{0,40}$/i);
    const isStyleDup = prefixMatch && (UI_STYLE_RE.test(title) || STYLE_ONLY_RE.test(title));
    if (!(severity === 'blue' && prefixMatch) && !isStyleDup) {
      out.push(issue);
      continue;
    }
    const key = `${file}::${severity}::dup`;
    const bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, { items: [issue], index: out.length });
      out.push(null);
    } else {
      bucket.items.push(issue);
    }
  }
  for (const bucket of buckets.values()) {
    const items = bucket.items;
    if (items.length === 1) {
      out[bucket.index] = items[0];
      continue;
    }
    const first = items[0];
    const tokens = items.map((i) => {
      const t = String(i.title || '').replace(/^(重复的|重复|Duplicated?|Duplicate|Repeated|冗余的|冗余|相似的|相同的)\s*/i, '').trim();
      return t || '组件';
    });
    const uniqueTokens = Array.from(new Set(tokens));
    const head = uniqueTokens.slice(0, 5).join('、');
    const extra = uniqueTokens.length > 5 ? ` 等共 ${uniqueTokens.length} 类` : '';
    out[bucket.index] = {
      ...first,
      title: '重复的 UI 组件 / 样式 pattern',
      desc: `同一文件出现多类 UI/组件/样式重复：${head}${extra}。建议整体评估是否抽取公共组件或样式 token。`,
      fix: '按需提取为共享组件、hook 或 className 常量；优先处理使用次数最多的 2–3 个。',
    };
  }
  return out.filter(Boolean);
}

function dedupeIssues(issues) {
  const map = new Map();
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object') continue;
    const file = String(issue.file || '').trim();
    const severity = String(issue.severity || '').trim().toLowerCase();
    const titleKey = String(issue.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const key = `${file}::${severity}::${titleKey}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...issue, severity, _lines: issue.line ? [issue.line] : [] });
      continue;
    }
    if (issue.line && !existing._lines.includes(issue.line)) {
      existing._lines.push(issue.line);
    }
  }
  const MAX_LINES_IN_DESC = 5;
  const truncateDescLineList = (desc) => {
    if (!desc) return desc;
    return desc.replace(
      /((?:行\s*(?:号)?\s*[:：]?\s*|lines?\s*[:：]?\s*)?)((?:\d{1,6}\s*[,，、]\s*){8,}\d{1,6})/gi,
      (_, prefix, numsPart) => {
        const nums = numsPart.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
        if (nums.length <= MAX_LINES_IN_DESC) return `${prefix}${numsPart}`;
        const head = nums.slice(0, MAX_LINES_IN_DESC).join(', ');
        return `${prefix}${head} 等共 ${nums.length} 处`;
      }
    );
  };
  return Array.from(map.values()).map((issue) => {
    if (issue._lines && issue._lines.length > 1) {
      const lines = issue._lines.slice().sort((a, b) => a - b);
      const total = lines.length;
      const head = lines.slice(0, MAX_LINES_IN_DESC);
      const suffix = total > MAX_LINES_IN_DESC
        ? `（影响行: ${head.join(', ')} 等共 ${total} 处）`
        : `（影响行: ${head.join(', ')}）`;
      const rawDesc = String(issue.desc || '');
      const cleanedDesc = rawDesc.replace(/[（(]?(?:影响行|affected lines?)[:：][^）)]*[）)]?/gi, '').trim();
      return {
        ...issue,
        desc: `${cleanedDesc}${cleanedDesc ? ' ' : ''}${suffix}`.trim(),
        line: lines[0],
        _lines: undefined,
      };
    }
    return { ...issue, desc: truncateDescLineList(String(issue.desc || '')), _lines: undefined };
  });
}

function reclassifySeverity(issue) {
  const title = String(issue.title || '');
  const desc = String(issue.desc || '');
  const combined = title + ' ' + desc;
  if (UI_STYLE_RE.test(combined) || STYLE_ONLY_RE.test(title)) return 'blue';
  if (/(?:命名.*(?:偏好|建议|不清晰)|naming\s*(?:preference|suggestion|unclear))/i.test(combined)) return issue.severity === 'red' ? 'yellow' : issue.severity;
  return issue.severity;
}

const MAX_ISSUES = 10;

const CATEGORY_RULES = [
  [/xss|注入|inject|密钥|secret|hardcod|鉴权|auth|csrf|敏感|leak|泄露|加密|crypto|ssrf|traversal|prototype.?pollution|deserializ/i, 'security'],
  [/竞态|race|数据丢失|data.?loss|逻辑错误|logic.?error|金额|currency|float.?arithmetic|精度|decimal|不变式|invariant|死循环|infinite|无限递归|unbounded/i, 'correctness'],
  [/泄漏|resource.?leak|内存|memory|crash|崩溃|未释放|not.?released|listener.?leak|promise.?reject.*顶层|unhandled.?reject/i, 'stability'],
  [/null|undefined|边界|boundary|off.?by.?one|越界|bounds|校验|validat|幂等|idempoten|重复提交|duplicate.?submit/i, 'logic'],
  [/n\+1|o\(n|性能|perf|memo|重渲染|re-?render|分页|pagina|unbounded.?list|blocking/i, 'perf'],
  [/\bany\b|类型|type.?safe|断言|assert|ts-ignore|non-?null/i, 'types'],
  [/api|状态码|status.?code|breaking.?change|contract|响应|response/i, 'api'],
  [/loading|error.?state|ux|用户体验|silent.?fail|静默失败/i, 'ux'],
  [/重复|duplicat|dead.?code|死代码|unused|魔法数字|magic.?number|注释|comment|文档|document|inconsisten|不一致/i, 'quality'],
  [/命名|naming|格式|format|style|风格|缩进|indent|prettier|eslint/i, 'style'],
];

function inferCategory(issue) {
  if (issue.category && issue.category !== 'unknown') return issue.category;
  const text = `${issue.title || ''} ${issue.desc || ''}`;
  for (const [re, cat] of CATEGORY_RULES) {
    if (re.test(text)) return cat;
  }
  return 'quality';
}

function sanitizeIssues(issues) {
  return issues
    .map((issue) => {
      const sev = reclassifySeverity(issue);
      const line = typeof issue.line === 'number' ? issue.line : parseInt(issue.line, 10);
      const category = inferCategory(issue);
      return { ...issue, severity: sev, category, line: Number.isFinite(line) && line > 0 ? line : undefined };
    })
    .slice(0, MAX_ISSUES);
}

function extractIssuesFromProse(markdown) {
  const issues = [];
  const blocks = markdown.split(/###\s*\[?/);
  for (const block of blocks) {
    const sevMatch = block.match(/^(🔴|🟡|🟢|🔵)\]?\s*(.+?)[\r\n]/);
    if (!sevMatch) continue;
    const sevMap = { '🔴': 'red', '🟡': 'yellow', '🟢': 'green', '🔵': 'blue' };
    const severity = sevMap[sevMatch[1]] || 'green';
    const title = sevMatch[2].trim();
    const fileMatch = block.match(/\*\*(?:文件|File)\*\*[:：]\s*`?([^`\n]+)`?/i);
    const lineMatch = block.match(/\*\*(?:行号|Line)\*\*[:：]\s*(\d+)/i);
    const descMatch = block.match(/\*\*(?:问题|Issue)\*\*[:：]\s*(.+)/i);
    const fixMatch = block.match(/\*\*(?:修复|Fix)\*\*[:：]\s*(.+)/i);
    issues.push({
      file: fileMatch?.[1]?.trim() || '',
      line: lineMatch ? parseInt(lineMatch[1], 10) : undefined,
      severity,
      title,
      desc: descMatch?.[1]?.trim() || title,
      fix: fixMatch?.[1]?.trim() || '',
    });
  }
  return issues;
}

export function parseReview(content) {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);

  let rawIssues = [];
  let summary = '';
  let parsedFromJson = false;

  if (jsonMatch) {
    try {
      const result = JSON.parse(jsonMatch[1]);
      rawIssues = Array.isArray(result.issues) ? result.issues : [];
      summary = result.summary || '';
      parsedFromJson = true;
    } catch { /* fall through to prose extraction */ }
  }

  if (!parsedFromJson || rawIssues.length === 0) {
    const proseIssues = extractIssuesFromProse(content);
    if (proseIssues.length > 0) {
      rawIssues = proseIssues;
      if (!summary) summary = proseIssues[0]?.title || 'AI 输出已从 prose 提取';
    }
  }

  if (rawIssues.length === 0 && !parsedFromJson) {
    return { markdown: content, score: 0, red: 0, yellow: 0, green: 0, blue: 0, summary: 'AI 未返回可解析的审查结果', issues: [], parseError: true };
  }

  const issues = sanitizeIssues(collapseSimilarIssues(dedupeIssues(rawIssues)));
  const red = issues.filter((i) => i.severity === 'red').length;
  const yellow = issues.filter((i) => i.severity === 'yellow').length;
  const green = issues.filter((i) => i.severity === 'green').length;
  const blue = issues.filter((i) => i.severity === 'blue').length;
  return {
    markdown: content,
    issues,
    red,
    yellow,
    green,
    blue,
    score: calcScore(red, yellow, green, blue),
    summary,
    parseError: false,
  };
}
