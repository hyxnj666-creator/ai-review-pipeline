# ai-review-pipeline

AI 驱动的代码质量流水线 CLI —— Review → 测试 → 报告，一条命令搞定。加 `--fix` 启用自动修复循环。

**[English](./README.md) | 中文** · [![Linux DO](https://img.shields.io/badge/社区讨论-Linux%20DO-blue)](https://linux.do)

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
- **HTML 可视化报告** — 评分 + 问题列表 + 修复建议，可附到 PR
- **JSONC 配置** — `.ai-pipeline.json` 支持注释，团队共享，clone 即生效
- **CI 友好** — `--json` 输出 + exit code，直接接 GitHub Actions / GitLab CI
- **双语 prompt** — `--lang en` 同时切换输出语言和 AI prompt 为英文
- **多语言代码支持** — TypeScript / JavaScript / Vue / Python / Go / Rust / Java / Swift / PHP / Kotlin

## 快速开始

```bash
# 零配置，直接跑（内置免费模型）
npx ai-review-pipeline

# 自动修复流水线
npx ai-review-pipeline --fix
```

> 💡 无需配置任何 API Key 即可体验完整流程。内置免费模型有速率限制，配置自己的 Key 可获得更快更稳定的体验。

<details>
<summary>配置自己的 API Key（可选，推荐）</summary>

```bash
# 任选一种模型服务，写入 .env.local

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
① 确定性规则检查 + AI Review（1 轮，只读不改码）
       │
② AI 测试用例生成（功能/对抗/边界）
       │
③ 生成 HTML 报告
       │
④ Gate 门禁（任何 🔴 / 🟡 超限 / 分数不达标 → exit 1 阻断；否则 exit 0）
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
| `ai-rp test` | 独立 AI 测试用例生成 |
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

### Gate 门禁参数（review 和 fix 通用）

| 参数 | 说明 |
|------|------|
| `--threshold <n>` | 分数阈值（默认 85） |
| `--max-major <n>` | 允许的最大 🟡 Major 数量，超出即阻断（默认 3）。任何 🔴 Blocker 直接阻断。 |
| `--no-test` | 跳过测试用例生成 |
| `--skip <levels>` | 跳过指定严重级别（如 `red,yellow`） |

### Fix 参数

| 参数 | 说明 |
|------|------|
| `--max-rounds <n>` | 最大修复轮次（默认 5） |
| `--no-commit` | 修复后不自动 git commit |

### Exit Code

| 场景 | Exit Code |
|------|-----------|
| Gate 通过（无 Blocker、Major ≤ max-major、分数 ≥ threshold） | `0` |
| Gate 阻断（有 Blocker / Major 超限 / 分数不达标） | `1` |
| `--fix` 通过 | `0` |
| `--fix` maxRounds 用完仍未通过 | `1`（阻断 CI/Hook，但报告照出） |

### `--file` vs `--full` 区别

```bash
# 只 review 该文件的 git 改动部分
ai-rp --file src/utils.ts

# review 完整文件内容（不管有没有 git 改动）
ai-rp --file src/utils.ts --full

# 不带 --file：review 所有 staged / HEAD 的 git 变动
ai-rp
```

---

### `test` — AI 测试用例生成

为指定文件生成三类测试用例。

| 参数 | 说明 |
|------|------|
| `--file <path>` | 指定文件 |
| `--staged` | 为 staged 文件生成测试 |

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
| **硅基流动** | `Qwen2.5-Coder-7B` | `SILICONFLOW_API_KEY` | 国内推荐，有免费额度 |
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
    "threshold": 85,           // 分数阈值（0-100）
    "maxMajor": 3,             // 🟡 Major 超过此数量即阻断
    "maxRounds": 5,            // --fix 模式最大修复轮数
    "model": "",               // 指定模型（默认 gpt-4o-mini）
    "maxDiffLines": 1500,      // diff 超过此行数自动截断
    "customRules": [           // 项目自定义审查规则
      "禁止使用 any 类型",
      "API Key / Secret 不得硬编码"
    ]
  },
  "fix": {
    "safetyMinRatio": 0.5      // 修复后文件不能低于原文件 50%（防截断）
  },
  "test": {
    "stack": "auto",           // 自动检测技术栈，或手动指定
    "maxCases": 8              // 最大测试用例数
  },
  "report": {
    "outputDir": ".ai-reports",
    "open": true               // 生成后自动打开报告
  }
}
```

## 严重级别 & 评分（商业化交付标准）

基础分: 100，默认通过阈值: 85。

| 级别 | 名称 | 覆盖范围 | 扣分 | 门禁规则 |
|------|------|---------|------|---------|
| 🔴 | **Blocker** | 安全漏洞（XSS、注入、硬编码密钥、CSRF、数据泄露）、正确性 bug（业务逻辑错误、竞态条件、静默丢数据）、稳定性风险（资源泄漏、内存泄漏、未处理的 rejection） | **-25** 每个 | **任何一个 🔴 即阻断合并** |
| 🟡 | **Major** | 未判空的方法调用、缺少输入校验、吞掉异常、危险类型转换、热路径性能问题、关键路径 UX 退化 | **-5** 每个 | **超过 3 个阻断合并** |
| 🟢 | **Minor** | 业务逻辑重复、魔法数字、复杂算法缺少文档、轻度性能提示、死代码 | **-1** 每个 | 仅影响分数 |
| 🔵 | **Info** | UI/样式重复、命名偏好、格式、重构建议 | **0** 每个（密度惩罚：超过 5 个后每个 -1，最多 -3） | 不阻断 |

### Gate 门禁逻辑（三重检查）

1. 任何 🔴 Blocker → **阻断**（输出原因：`blocker:1(security:1)`）
2. 🟡 Major > `--max-major`（默认 3）→ **阻断**
3. 分数 < `--threshold`（默认 85）→ **阻断**
4. 全部通过 → **PASS**

### 问题分类

每个问题自动归类为以下之一：`security` | `correctness` | `stability` | `logic` | `perf` | `types` | `api` | `ux` | `quality` | `style`。分类信息展示在 JSON 输出和 HTML 报告中，便于团队分工处理。

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

## 常用命令速查

```bash
# ── 默认模式（Review + 测试 + 报告，只读） ──
ai-rp                                          # review git 变动
ai-rp --file src/a.vue                         # 指定文件
ai-rp --file src/a.vue --full                  # review 完整文件
ai-rp --file src/views --full                  # review 整个文件夹
ai-rp --branch main                            # 对比分支
ai-rp --staged --json                          # CI 模式

# ── 修复模式（Review + 自动修复 + 测试 + 报告） ──
ai-rp --fix                                    # 完整修复流水线
ai-rp fix                                      # 同上（命令别名）
ai-rp --fix --file src/a.vue --full            # 修复指定文件
ai-rp fix --threshold 90 --max-rounds 3        # 自定义参数
ai-rp fix --max-major 5                        # 提高 Major 容忍度
ai-rp fix --no-commit --skip green             # 不提交，只修红黄

# ── 独立测试 ──
ai-rp test --file src/utils.ts                 # 生成测试
ai-rp test --staged                            # staged 文件测试

# ── 初始化 ──
ai-rp init                                     # 生成配置文件
```

## 社区

- [Linux DO 讨论](https://linux.do) — 中文社区讨论帖

## License

MIT
