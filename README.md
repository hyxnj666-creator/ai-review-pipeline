# ai-review-pipeline

AI 驱动的代码质量流水线 CLI —— Review → 自动修复 → 再审 → 测试 → 报告，一条命令搞定。

**[English](#english) | 中文**

---

## 特性

- **零依赖** — 无 required dependencies，`npx` 秒级执行
- **三种模式** — `review`（只读）/ `fix`（自动修复循环）/ `fix --dry-run`（出报告不阻断）
- **灵活目标** — 支持文件、文件夹、逗号分隔多目标
- **HTML 可视化报告** — 评分 + 问题列表 + 修复建议，可附到 PR
- **项目配置化** — `.ai-pipeline.json` 团队共享，clone 即生效
- **CI 友好** — `--json` 输出 + exit code，直接接 GitHub Actions / GitLab CI
- **多语言** — 默认中文，`--lang en` 切英文
- **多语言代码支持** — TypeScript / JavaScript / Vue / Python / Go / Rust / Java

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

## 命令

### `review` — AI Code Review（只读）

```bash
ai-rp review                          # Review staged 改动
ai-rp review --file src/components    # Review 指定文件夹
ai-rp review --file "a.tsx,b.tsx"     # 多目标
ai-rp review --branch main            # 对比分支
ai-rp review --json                   # JSON 输出（CI 用）
ai-rp review --no-report              # 不生成 HTML 报告
```

### `fix` — 完整流水线

```bash
ai-rp fix                             # Review → 修复 → 再 Review → 测试 → 提交
ai-rp fix --dry-run                   # 跑全流程出报告，不修改代码不阻断
ai-rp fix --threshold 90              # 自定义质量阈值
ai-rp fix --max-rounds 5              # 最大修复轮次
ai-rp fix --no-commit                 # 修复后不自动提交
ai-rp fix --no-test                   # 跳过测试用例生成
ai-rp fix --skip green,yellow         # 只修 🔴 必修项
ai-rp fix --file src/utils            # 指定目标
```

**流程图：**

```
① AI Review（评分 + 问题列表）
       │
       ├─ 达标 ──→ ④ 测试
       │
       └─ 未达标 → ② AI 自动修复（展示 git diff）
                        │
                        └→ ① 再次 Review（最多 N 轮）
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
① AI Review → ② 测试 → ③ 报告 → exit 0（不修改，不阻断）
```

### `test` — AI 测试用例生成

```bash
ai-rp test --file src/utils.ts        # 为指定文件生成
ai-rp test --staged                   # 为 staged 文件生成
```

生成三类用例：
- ✅ **功能用例** — 正常业务流程验证
- ⚔️ **对抗用例** — XSS / 注入 / 越权 / 异常输入
- 🔲 **边界用例** — 空值 / 0 / 极大值 / 超时

### `init` — 初始化配置

```bash
ai-rp init    # 在项目根目录生成 .ai-pipeline.json
```

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
    "review:fix": "ai-rp fix",
    "review:dry": "ai-rp fix --dry-run",
    "test:ai": "ai-rp test --staged"
  }
}
```

## 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| `OPENAI_API_KEY` | OpenAI API Key | 是 |
| `AI_REVIEW_API_KEY` | 覆盖 OPENAI_API_KEY | 否 |
| `AI_REVIEW_BASE_URL` | 自定义 API 地址（兼容 OpenAI 接口的服务） | 否 |
| `AI_REVIEW_MODEL` | 覆盖默认模型 | 否 |
| `HTTPS_PROXY` | HTTP 代理（需安装 https-proxy-agent） | 否 |

支持 `.env.local` 和 `.env` 文件自动加载。

---

<a id="english"></a>

## English

### What is this?

An AI-powered code quality CLI tool. One command to review, auto-fix, test, and report.

### Quick Start

```bash
export OPENAI_API_KEY=sk-xxx
npx ai-review-pipeline review           # Review code
npx ai-review-pipeline fix              # Full pipeline
npx ai-review-pipeline fix --dry-run    # Report only, no changes
```

### Commands

| Command | Description |
|---------|-------------|
| `ai-rp review` | AI Code Review (read-only) |
| `ai-rp fix` | Review → Auto-fix → Re-review → Test → Commit |
| `ai-rp fix --dry-run` | Full pipeline → report only, no blocking |
| `ai-rp test --file <path>` | Generate test cases |
| `ai-rp init` | Create `.ai-pipeline.json` config |

Use `--lang en` for English output.

### Install

```bash
npm install -D ai-review-pipeline   # Project-level
npm install -g ai-review-pipeline   # Global
npx ai-review-pipeline review       # No install needed
```

## License

MIT
