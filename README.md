# ai-review-pipeline

AI 驱动的代码质量流水线 CLI —— Review → 自动修复 → 再审 → 测试 → 报告，一条命令搞定。

**[English](#english) | 中文**

---

## 特性

- **零依赖** — 无 required dependencies，`npx` 秒级执行
- **三种模式** — `review`（只读）/ `fix`（自动修复循环）/ `--dry-run`（出报告不阻断）
- **灵活目标** — 支持文件、文件夹、逗号分隔多目标
- **`--full` 完整审查** — 无需 git 改动，直接对完整文件做质量审查
- **HTML 可视化报告** — 评分 + 问题列表 + 修复建议，可附到 PR
- **项目配置化** — `.ai-pipeline.json` 团队共享，clone 即生效
- **CI 友好** — `--json` 输出 + exit code，直接接 GitHub Actions / GitLab CI
- **多语言** — 默认中文，`--lang en` 切英文
- **多语言代码支持** — TypeScript / JavaScript / Vue / Python / Go / Rust / Java / Swift / PHP / Kotlin

## 快速开始

```bash
# 1. 配置 API Key（任选一种）
export OPENAI_API_KEY=sk-xxx
# 或写入 .env.local：echo 'OPENAI_API_KEY=sk-xxx' >> .env.local

# 2. Review 代码（不安装，直接跑）
npx ai-review-pipeline review

# 3. 完整流水线（Review → 修复 → 再审 → 测试 → 提交）
npx ai-review-pipeline fix
```

## 安装

```bash
# 方式一：项目级安装（推荐团队使用）
npm install -D ai-review-pipeline

# 方式二：全局安装
npm install -g ai-review-pipeline

# 方式三：不安装，npx 直接用
npx ai-review-pipeline review
```

安装后可使用短名 `ai-rp` 替代 `ai-review-pipeline`。

---

## 完整命令手册

### 通用参数（所有命令均可使用）

| 参数 | 说明 |
|------|------|
| `--file <path>` | 指定目标文件/文件夹/多目标（逗号分隔） |
| `--full` | 配合 `--file` 使用，审查完整文件内容（无需 git 改动） |
| `--dry-run` | 所有命令通用，出报告不阻断，不修改代码，exit 0 |
| `--lang <zh\|en>` | 输出语言（默认中文） |
| `--help` / `-h` | 显示帮助 |
| `--version` / `-v` | 显示版本 |

#### `--file` vs `--full` 区别

```bash
# 只 review 该文件的 git 改动部分（无改动则无输出）
ai-rp review --file src/utils.ts

# review 完整文件内容（不管有没有 git 改动，都会执行）
ai-rp review --file src/utils.ts --full

# 不带 --file：review 所有 staged / HEAD 的 git 变动
ai-rp review
```

#### `--dry-run` 行为

| 命令 | 正常模式 | `--dry-run` 模式 |
|------|---------|-----------------|
| `review` | 有 🔴 问题 → exit 1 阻断 | 出报告 → exit 0 不阻断 |
| `fix` | Review → 修复 → 再审 → 测试 → 提交 | Review → 测试 → 报告 → exit 0（不修改不提交） |
| `test` | 生成测试用例 | 生成测试用例 → exit 0 |

---

### `review` — AI Code Review（只读）

对代码做质量审查，输出评分 + 问题列表 + 修复建议。不修改任何代码。

#### 专属参数

| 参数 | 说明 |
|------|------|
| `--staged` | 只 review git staged 改动 |
| `--branch <base>` | 对比分支（如 `main`） |
| `--json` | JSON 格式输出（CI/CD 用） |
| `--no-report` | 不生成 HTML 报告 |

#### 用法示例

```bash
# 默认：review 所有 staged / HEAD 改动
ai-rp review

# 指定文件（只看 git 改动）
ai-rp review --file src/components/Button.vue

# 指定文件（审查完整内容，不依赖 git 变动）
ai-rp review --file src/components/Button.vue --full

# 指定文件夹（审查所有代码文件）
ai-rp review --file src/views --full

# 多目标
ai-rp review --file "src/a.ts,src/b.vue" --full

# 对比分支
ai-rp review --branch main

# 只看 staged 改动
ai-rp review --staged

# JSON 输出（接 CI）
ai-rp review --json

# dry-run（有问题也不阻断）
ai-rp review --file src/utils.ts --full --dry-run
```

---

### `fix` — 完整自动修复流水线

Review → 自动修复 → 再 Review → 测试用例生成 → HTML 报告 → 自动提交。

#### 专属参数

| 参数 | 说明 |
|------|------|
| `--threshold <n>` | 质量阈值（默认 95，0-100） |
| `--max-rounds <n>` | 最大修复轮次（默认 3） |
| `--no-commit` | 修复后不自动 git commit |
| `--no-test` | 跳过测试用例生成 |
| `--skip <levels>` | 跳过指定级别的修复（如 `green,yellow`） |

#### 用法示例

```bash
# 默认：完整流水线
ai-rp fix

# dry-run：出报告不修改不阻断
ai-rp fix --dry-run

# 指定文件 + 完整审查 + dry-run
ai-rp fix --file src/views/Home.vue --full --dry-run

# 自定义阈值和轮次
ai-rp fix --threshold 90 --max-rounds 5

# 修复后不自动提交
ai-rp fix --no-commit

# 跳过测试生成
ai-rp fix --no-test

# 只修 🔴 必修项（跳过 🟡🟢）
ai-rp fix --skip green,yellow

# 指定文件夹
ai-rp fix --file src/utils --full
```

#### 流程图

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
                                └─ 到达上限 → ④

④ AI 测试用例生成（功能/对抗/边界）
       │
⑤ 生成 HTML 报告
       │
⑥ 自动 git commit
```

**`--dry-run` 模式：**

```
① AI Review → ② 测试 → ③ 报告 → exit 0（不修改，不提交，不阻断）
```

---

### `test` — AI 测试用例生成

为指定文件生成三类测试用例。

#### 专属参数

| 参数 | 说明 |
|------|------|
| `--staged` | 为 staged 文件生成测试 |

#### 用法示例

```bash
# 指定文件
ai-rp test --file src/utils.ts

# 指定文件夹
ai-rp test --file src/composables

# staged 文件
ai-rp test --staged

# dry-run
ai-rp test --file src/api.ts --dry-run
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

## 配置文件

运行 `ai-rp init` 生成 `.ai-pipeline.json`，提交到 git 团队共享：

```jsonc
{
  "review": {
    "threshold": 95,           // 质量阈值（0-100）
    "maxRounds": 3,            // fix 模式最大修复轮数
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

## 评分标准

| 级别 | 含义 | 扣分 |
|------|------|------|
| 🔴 必修 | 逻辑错误、安全漏洞、数据风险 | -15/个 |
| 🟡 建议 | 边界未处理、类型问题、错误处理缺失 | -5/个 |
| 🟢 优化 | 代码重复、命名不清、性能隐患 | -2/个 |

## 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| `OPENAI_API_KEY` | OpenAI API Key | 是 |
| `AI_REVIEW_API_KEY` | 覆盖 OPENAI_API_KEY | 否 |
| `AI_REVIEW_BASE_URL` | 自定义 API 地址（兼容 OpenAI 接口的服务） | 否 |
| `AI_REVIEW_MODEL` | 覆盖默认模型 | 否 |
| `HTTPS_PROXY` | HTTP 代理（需安装 https-proxy-agent） | 否 |

支持 `.env.local` 和 `.env` 文件自动加载。

## CI/CD 集成

### GitHub Actions

```yaml
- name: AI Code Review
  run: npx ai-review-pipeline review --json
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### GitLab CI

```yaml
ai-review:
  script:
    - npx ai-review-pipeline review --json
  variables:
    OPENAI_API_KEY: $OPENAI_API_KEY
  allow_failure: false
```

## 在 package.json 中配置 scripts

```json
{
  "scripts": {
    "review": "ai-rp review",
    "review:full": "ai-rp review --full",
    "review:fix": "ai-rp fix",
    "review:dry": "ai-rp fix --dry-run",
    "test:ai": "ai-rp test --staged"
  }
}
```

## 常用命令速查

```bash
# ── Review ──
ai-rp review                                        # review git 变动
ai-rp review --file src/a.vue --full                # review 完整文件
ai-rp review --file src/views --full --dry-run      # review 文件夹，不阻断
ai-rp review --branch main                          # 对比分支
ai-rp review --staged --json                        # CI 模式

# ── Fix 流水线 ──
ai-rp fix                                           # 完整流水线
ai-rp fix --dry-run                                 # 出报告不修改
ai-rp fix --file src/a.vue --full --dry-run         # 完整审查 + 报告
ai-rp fix --threshold 90 --max-rounds 5             # 自定义参数
ai-rp fix --no-commit --skip green                  # 不提交，只修红黄

# ── Test ──
ai-rp test --file src/utils.ts                      # 生成测试
ai-rp test --staged                                 # staged 文件测试

# ── Init ──
ai-rp init                                          # 生成配置文件
```

---

<a id="english"></a>

## English

### What is this?

An AI-powered code quality CLI tool. One command to review, auto-fix, test, and report.

### Quick Start

```bash
export OPENAI_API_KEY=sk-xxx
npx ai-review-pipeline review                          # Review code
npx ai-review-pipeline fix                             # Full pipeline
npx ai-review-pipeline fix --dry-run                   # Report only, no changes
npx ai-review-pipeline review --file src/a.vue --full  # Review full file
```

### Commands

| Command | Description |
|---------|-------------|
| `ai-rp review` | AI Code Review (read-only) |
| `ai-rp review --full` | Review full file content (no git changes needed) |
| `ai-rp fix` | Review → Auto-fix → Re-review → Test → Commit |
| `ai-rp fix --dry-run` | Full pipeline → report only, no blocking |
| `ai-rp test --file <path>` | Generate test cases |
| `ai-rp init` | Create `.ai-pipeline.json` config |

### Global Options

| Option | Description |
|--------|-------------|
| `--file <path>` | Target file/folder/multi-path (comma-separated) |
| `--full` | Review full file content, use with `--file` |
| `--dry-run` | Report only, no changes, no blocking (all commands) |
| `--lang <zh\|en>` | Output language (default: zh) |

### `--file` vs `--full`

```bash
ai-rp review --file src/a.vue          # Only git changes for that file
ai-rp review --file src/a.vue --full   # Full file content (no git changes needed)
ai-rp review                           # All staged/HEAD git changes
```

### Install

```bash
npm install -D ai-review-pipeline   # Project-level
npm install -g ai-review-pipeline   # Global
npx ai-review-pipeline review       # No install needed
```

Use `--lang en` for English output.

## License

MIT
