# ai-review-pipeline

AI 驱动的代码质量流水线 CLI —— Review → 测试 → 报告，一条命令搞定。加 `--fix` 启用自动修复循环。

**[English](./README.md) | 中文**

---

## 特性

- **零配置即跑** — 内置免费 AI 模型，`npx ai-review-pipeline` 无需任何 Key 即可体验完整流程
- **流式输出** — 逐 token 实时显示 AI 审查结果，不再盯着空白屏幕等待
- **大文件分片审查** — 超长 diff 自动按文件拆分，确保完整覆盖不截断
- **零依赖** — 无 required dependencies，`npx` 秒级执行
- **多 AI 模型** — OpenAI / DeepSeek / Claude / 通义千问 / Gemini / 硅基流动 / Ollama，自动识别
- **统一流水线** — 默认 Review + 测试 + 报告（只读），`--fix` 启用自动修复循环
- **灵活目标** — 支持文件、文件夹、逗号分隔多目标
- **`--full` 完整审查** — 无需 git 改动，直接对完整文件做质量审查
- **HTML 可视化报告** — 评分 + 问题列表 + 修复建议 + 语法高亮代码上下文，可附到 PR
- **JSONC 配置** — `.ai-pipeline.json` 支持注释，团队共享，clone 即生效
- **CI 友好** — `--json` 输出 + exit code，直接接 GitHub Actions / GitLab CI
- **双语 prompt** — `--lang en` 同时切换输出语言和 AI prompt 为英文
- **多语言代码支持** — TypeScript / JavaScript / Vue / Python / Go / Rust / Java / Swift / PHP / Kotlin

## 快速开始

```bash
# 零配置，直接跑（内置免费模型）
# 默认行为：review 当前 git 变动，然后生成测试和报告
npx ai-review-pipeline

# 自动修复当前 git 变动
npx ai-review-pipeline --fix

# 直接审查指定文件 / 文件夹
npx ai-review-pipeline --file src/ --full
```

> 💡 无需配置任何 API Key 即可体验完整流程。内置免费模型（SiliconFlow）有速率限制，配置自己的 Key 可获得更快更稳定的体验。

## 最容易误解的 4 条命令

```bash
# 1）默认模式：review 当前 git 变动
ai-rp

# 2）直接指定某个文件 / 目录
ai-rp --file src/utils.ts

# 3）强制审查当前完整文件 / 目录
ai-rp --file src/utils.ts --full

# 4）按同样的目标选择规则执行自动修复
ai-rp --fix
```

可以直接这样理解：

- `ai-rp`：优先 review staged；没有 staged 就看 `git diff HEAD`
- `ai-rp --file <path>`：指定文件/目录；优先看 git diff，没有 diff 就回退到当前文件内容
- `ai-rp --file <path> --full`：强制审查当前完整文件/目录
- `ai-rp --fix`：沿用同样的目标选择规则，然后执行 review + auto-fix + re-review + test + report

如果你的目标就是“现在就检查这个文件本身”，最稳的命令是：

```bash
ai-rp --file path/to/file --full
```

<details>
<summary>配置自己的 API Key（可选，推荐）</summary>

```bash
# 任选一种模型服务，写入 .env.local

# OpenAI + GPT-5
echo 'OPENAI_API_KEY=sk-xxx' >> .env.local
echo 'AI_REVIEW_MODEL=gpt-5-chat-latest' >> .env.local

# DeepSeek（国内推荐，便宜好用）
echo 'DEEPSEEK_API_KEY=sk-xxx' >> .env.local

# OpenAI
echo 'OPENAI_API_KEY=sk-xxx' >> .env.local

# Claude
echo 'ANTHROPIC_API_KEY=sk-ant-xxx' >> .env.local

# 通义千问
echo 'DASHSCOPE_API_KEY=sk-xxx' >> .env.local

# Google Gemini
echo 'GEMINI_API_KEY=xxx' >> .env.local

# 本地 Ollama（无需 Key，启动 ollama serve 即可）
echo 'AI_REVIEW_PROVIDER=ollama' >> .env.local
```

</details>

## 安装

```bash
# 方式一：项目级安装（推荐团队使用）
npm install -D ai-review-pipeline

# 方式二：全局安装
npm install -g ai-review-pipeline

# 方式三：不安装，npx 直接用
npx ai-review-pipeline
```

安装后可使用短名 `ai-rp` 替代 `ai-review-pipeline`。

---

## 流程设计

### 默认模式（Review + Test + Report）

```
① AI Review（1 轮，只读不改码）
       │
② AI 测试生成（功能/对抗/边界）
       │
③ 执行生成出的真实测试（JS/TS 项目优先支持 Vitest/Jest）
       │
④ 生成 HTML 报告
       │
⑤ Exit（有 🔴 问题 → exit 1 阻断；无 🔴 → exit 0）
```

### `--fix` 模式（Review + Fix Loop + Test + Report）

```
① AI Review（评分 + 问题列表）
       │
       ├─ 达标 ──→ ④ 测试
       │
       └─ 未达标 → ② AI 自动修复（展示 git diff）
                        │
                        └→ ③ 再次 Review（最多 N 轮）
                                │
                                ├─ 达标 → ④
                                └─ maxRounds 到了 → ④（照样出测试和报告）

④ AI 测试用例生成
       │
⑤ 生成 HTML 报告
       │
⑥ 自动 git commit（仅通过时）
       │
⑦ Exit（通过 → exit 0；未通过 → exit 1 阻断）
```

---

## 完整命令手册

### 命令

| 命令 | 说明 |
|------|------|
| `ai-rp` | 默认：Review + 测试 + 报告（只读） |
| `ai-rp review` | 同上（别名） |
| `ai-rp fix` | 等价 `ai-rp --fix`（Review + 修复循环 + 测试 + 报告） |
| `ai-rp test` | 独立 AI 测试生成 + 真实执行 |
| `ai-rp init` | 初始化配置文件 |

### 核心参数

| 参数 | 说明 |
|------|------|
| `--fix` | 启用自动修复模式（循环 review+fix） |
| `--file <path>` | 指定目标文件/文件夹/多目标（逗号分隔） |
| `--full` | 配合 `--file` 使用，审查完整文件内容（无需 git 改动） |
| `--model <name>` | 覆盖默认模型（如 `--model gpt-4o`） |
| `--lang <zh\|en>` | 输出语言（默认中文） |
| `--help` / `-h` | 显示帮助 |
| `--version` / `-v` | 显示版本 |

### Review 参数

| 参数 | 说明 |
|------|------|
| `--staged` | 只 review git staged 改动 |
| `--branch <base>` | 对比分支（如 `main`） |
| `--json` | JSON 格式输出（CI/CD 用） |
| `--no-report` | 不生成 HTML 报告 |
| `--no-run-tests` | 生成 AI 测试但跳过真实执行 |

### Fix 参数

| 参数 | 说明 |
|------|------|
| `--threshold <n>` | 质量阈值（默认 95，0-100） |
| `--max-rounds <n>` | 最大修复轮次（默认 5） |
| `--no-commit` | 修复后不自动 git commit |
| `--no-test` | 跳过 AI 测试生成和真实测试执行 |
| `--skip <levels>` | 跳过修复级别（如 `green,yellow`） |

### Exit Code

| 场景 | Exit Code |
|------|-----------|
| Review 通过（无 red 且分数达标） | `0` |
| Review 未通过（有 red 问题） | `1` |
| Review 通过但真实测试执行失败 | `1` |
| `--fix` 通过 | `0` |
| `--fix` maxRounds 用完仍未通过 | `1`（阻断 CI/Hook，但报告照出） |

### `--file` vs `--full` 区别

```bash
# 不带 --file：优先 review staged，若没有则 review 相对 HEAD 的 git 变动
ai-rp

# 带 --file：优先 review 该文件的 git diff
ai-rp --file src/utils.ts

# 如果该文件没有 git diff，或者当前目录不是 git 仓库，
# 工具会回退到直接读取当前文件内容进行 review

# 强制 review 完整文件内容（不管有没有 git 改动）
ai-rp --file src/utils.ts --full

# 文件夹也支持
ai-rp --file src/views --full
```

可以直接记成：

- `ai-rp` → review 当前 git 变动
- `ai-rp --file <path>` → 指定文件/文件夹；有 diff 看 diff，没有 diff 就看当前内容
- `ai-rp --file <path> --full` → 强制审查整个文件/文件夹
- `ai-rp --fix` → 按上面的目标选择规则执行自动修复 + 再审查 + 测试 + 报告

---

### `test` — AI 测试生成 + 真实执行

为指定文件生成三类测试用例；若项目里能检测到 JS/TS 测试执行器，则继续执行生成出来的测试文件。

| 参数 | 说明 |
|------|------|
| `--file <path>` | 直接指定文件 / 文件夹（不依赖 git 历史） |
| `--staged` | 为 staged 文件生成测试 |
| `--no-run-tests` | 只生成测试代码，不执行 |

```bash
ai-rp test --file src/utils.ts
ai-rp test --staged
```

#### 生成三类用例

| 类型 | 说明 |
|------|------|
| ✅ **功能用例** | 正常业务流程：CRUD、状态流转、组件渲染 |
| ⚔️ **对抗用例** | 异常输入：XSS、注入、越权、重复提交 |
| 🔲 **边界用例** | 边界条件：空值、0、极大值、超时 |

---

### `init` — 初始化配置

```bash
ai-rp init    # 在项目根目录生成 .ai-pipeline.json
```

---

## 支持的 AI 模型

| Provider | 默认模型 | 环境变量 | 说明 |
|----------|---------|---------|------|
| **OpenAI** | `gpt-4o-mini` | `OPENAI_API_KEY` | 默认 Provider |
| **DeepSeek** | `deepseek-chat` | `DEEPSEEK_API_KEY` | 国内推荐，性价比高 |
| **Claude** | `claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY` | 代码能力强 |
| **通义千问** | `qwen-plus` | `DASHSCOPE_API_KEY` | 阿里云 |
| **Gemini** | `gemini-2.0-flash` | `GEMINI_API_KEY` | Google |
| **硅基流动** | `Qwen2.5-Coder-32B` | `SILICONFLOW_API_KEY` | 国内推荐，价格低 |
| **Ollama** | `qwen2.5-coder` | 无需 Key | 本地部署，隐私安全 |
| **自定义** | — | `AI_REVIEW_API_KEY` | 任何 OpenAI 兼容 API |

### 自动识别

工具会自动识别 Provider：
- `sk-ant-` 开头的 Key → Claude
- `DEEPSEEK_API_KEY` → DeepSeek
- `ANTHROPIC_API_KEY` → Claude
- `DASHSCOPE_API_KEY` → 通义千问
- `GEMINI_API_KEY` → Gemini

也可手动指定：

```bash
# .env.local
AI_REVIEW_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-xxx

# 或自定义兼容 API
AI_REVIEW_PROVIDER=custom
AI_REVIEW_API_KEY=sk-xxx
AI_REVIEW_BASE_URL=https://your-api.com/v1
AI_REVIEW_MODEL=your-model
```

### Ollama 本地部署

```bash
# 1. 安装 Ollama: https://ollama.com
# 2. 拉取模型
ollama pull qwen2.5-coder

# 3. 配置
echo 'AI_REVIEW_PROVIDER=ollama' >> .env.local

# 4. 使用
npx ai-review-pipeline --file src/utils.ts --full
```

---

## 配置文件

运行 `ai-rp init` 生成 `.ai-pipeline.json`，提交到 git 团队共享：

```jsonc
{
  "review": {
    "threshold": 95,           // 质量阈值（0-100）
    "maxRounds": 5,            // --fix 模式最大修复轮数
    "model": "",               // 指定模型（如 gpt-5-chat-latest）
    "temperature": 0.1,        // 越低越稳定
    "maxTokens": 8192,         // review 输出 token 预算
    "maxDiffLines": 1500,      // diff 超过此行数自动截断
    "customRules": [           // 项目自定义审查规则
      "禁止使用 any 类型",
      "API Key / Secret 不得硬编码"
    ]
  },
  "fix": {
    "safetyMinRatio": 0.5,     // 修复后文件不能低于原文件 50%（防截断）
    "temperature": 0.2,
    "maxTokens": 8192
  },
  "test": {
    "run": true,               // 默认执行生成出来的测试
    "stack": "auto",           // 自动检测技术栈，或手动指定
    "maxCases": 8,             // 最大测试用例数
    "temperature": 0.4,
    "maxTokens": 12288,
    "tempDir": ".ai-tests",    // 临时生成测试文件目录
    "keepFailed": true,        // 执行失败时保留文件便于排查
    "command": "",             // 可选覆盖，例如 "npx vitest run {file}"（不含 {file} 时按原命令执行）
    "timeoutMs": 120000
  },
  "report": {
    "outputDir": ".ai-reports",
    "open": true               // 生成后自动打开报告
  }
}
```

如果你的 OpenAI 账号已经开通 GPT-5，可直接这样配：

```bash
OPENAI_API_KEY=sk-xxx
AI_REVIEW_MODEL=gpt-5-chat-latest
```

建议的起步 token 配置：

- `review.maxTokens`: `8192`
- `fix.maxTokens`: `8192`
- `test.maxTokens`: `12288`

真实测试执行说明：

- JS/TS 项目默认会在 AI 生成测试后执行真实测试
- 工具会优先自动识别 `vitest`，其次识别 `jest`
- 如需强制指定执行命令，可配置 `test.command`
- 如果希望 runner 直接执行生成出来的临时测试文件，请在 `test.command` 里使用 `{file}` 占位符
- 如果 `test.command` 不包含 `{file}`，则会按你写的命令原样执行
- 真实测试一旦执行且失败，pipeline 会以 `exit code 1` 结束
- 如果你只想保留 AI 生成的测试代码，可使用 `--no-run-tests` 或 `test.run: false`

## 评分标准

| 级别 | 含义 | 扣分 |
|------|------|------|
| 🔴 必修 | 逻辑错误、安全漏洞、数据风险、未捕获的异步错误、资源泄漏/死循环 | -20/个 |
| 🟡 建议 | 边界未处理、类型问题、错误处理缺失（仅影响体验；涉及数据/安全则升 🔴） | -5/个 |
| 🟢 优化 | 重复逻辑、抽象薄弱、维护性债务、风险较高的硬编码、真实质量问题 | -1/个 |
| 🔵 建议 | 命名润色、可选抽取、样式整理、注释建议、低优先级重构 | 0/个 |

## 环境变量

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | OpenAI API Key |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `ANTHROPIC_API_KEY` | Anthropic Claude API Key |
| `DASHSCOPE_API_KEY` | 阿里通义千问 API Key |
| `GEMINI_API_KEY` | Google Gemini API Key |
| `AI_REVIEW_API_KEY` | 通用 Key（优先级最高，覆盖以上所有） |
| `AI_REVIEW_PROVIDER` | 手动指定 Provider（openai/deepseek/claude/qwen/gemini/ollama/custom） |
| `AI_REVIEW_BASE_URL` | 自定义 API 地址 |
| `AI_REVIEW_MODEL` | 覆盖默认模型 |
| `HTTPS_PROXY` | HTTP 代理（需安装 https-proxy-agent） |

支持 `.env.local` 和 `.env` 文件自动加载。只需配置对应 Provider 的 Key，工具自动识别。

## CI/CD 集成

### GitHub Actions

```yaml
- name: AI Code Review
  run: npx ai-review-pipeline --json
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### GitLab CI

```yaml
ai-review:
  script:
    - npx ai-review-pipeline --json
  variables:
    OPENAI_API_KEY: $OPENAI_API_KEY
  allow_failure: false
```

### Git Hook（lefthook）

```yaml
# lefthook.yml
pre-push:
  commands:
    ai-review:
      run: npx ai-rp --fix --max-rounds 3
```

## 在 package.json 中配置 scripts

```json
{
  "scripts": {
    "review": "ai-rp",
    "review:full": "ai-rp --file src/ --full",
    "review:fix": "ai-rp --fix",
    "review:fix:full": "ai-rp --fix --file src/ --full",
    "test:ai": "ai-rp test --staged"
  }
}
```

## Benchmark 基线（仓库开发用）

用固定样例对比 prompt / model / rule 改动后，审查质量到底是变好了还是变差了。
这套 benchmark 主要用于仓库开发和贡献者验证，默认不会随 npm 发布包一起提供。

```bash
npm run benchmark
npm run benchmark -- --model gpt-4o-mini
npm run benchmark -- --case unsafe-html
```

当前样例覆盖：

- 真实阻塞风险识别（`unsafe-html`）
- 运行时空值访问问题（`unguarded-map`）
- Tailwind 低价值噪音抑制（`tailwind-noise`）
- 敏感信息硬编码泄露（`hardcoded-secret`）
- 危险类型断言，如 `as any`（`unsafe-any`）
- 未处理的异步 / 网络失败（`unhandled-fetch`）
- 重复提交 / 竞态型交互风险（`duplicate-submit`）

## 常用命令速查

```bash
# ── 默认模式（Review + 测试 + 报告，只读） ──
ai-rp                                          # review staged / HEAD 的 git 变动
ai-rp --file src/a.vue                         # 指定文件；优先看 diff，没有则回退文件内容
ai-rp --file src/a.vue --full                  # 强制 review 完整文件
ai-rp --file src/views --full                  # 强制 review 整个文件夹
ai-rp --branch main                            # 对比分支
ai-rp --staged --json                          # CI 模式

# ── 修复模式（Review + 自动修复 + 测试 + 报告） ──
ai-rp --fix                                    # 修复当前 git 变动
ai-rp fix                                      # 同上（命令别名）
ai-rp --fix --file src/a.vue --full            # 直接修复指定文件
ai-rp fix --threshold 90 --max-rounds 3        # 自定义参数
ai-rp fix --no-commit --skip green             # 不提交，只修红黄

# ── 独立测试 ──
ai-rp test --file src/utils.ts                 # 直接为该文件生成 / 执行测试
ai-rp test --staged                            # staged 文件测试

# ── 初始化 ──
ai-rp init                                     # 生成配置文件
```

## License

MIT
