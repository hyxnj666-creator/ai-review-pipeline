# ai-review-pipeline

AI-powered code quality pipeline CLI — Review + Test + Report in one command. Add `--fix` for auto-fix loop.

**English | [中文](./README.zh-CN.md)**

---

## Features

- **Zero config** — Built-in free AI model, `npx ai-review-pipeline` works out of the box with no API Key
- **Zero dependencies** — No required deps, instant `npx` execution
- **Multi-provider** — OpenAI / DeepSeek / Claude / Qwen / Gemini / Ollama, auto-detected
- **Unified pipeline** — Default: Review + Test + Report (read-only). `--fix` enables auto-fix loop
- **Flexible targets** — Files, folders, comma-separated multi-targets
- **`--full` mode** — Review entire file content without git changes
- **HTML reports** — Score + issue list + fix suggestions, attachable to PRs
- **Project config** — `.ai-pipeline.json` shared across team, works on clone
- **CI-ready** — `--json` output + exit codes for GitHub Actions / GitLab CI
- **Multi-language output** — Default: Chinese. `--lang en` for English
- **Multi-language code** — TypeScript / JavaScript / Vue / Python / Go / Rust / Java / Swift / PHP / Kotlin

## Quick Start

```bash
# Zero config — just run it (built-in free model)
npx ai-review-pipeline

# Auto-fix pipeline
npx ai-review-pipeline --fix
```

> 💡 No API Key needed to try the full pipeline. The built-in free model has rate limits — configure your own Key for a faster and more stable experience.

<details>
<summary>Configure your own API Key (optional, recommended)</summary>

```bash
# Pick any provider and add to .env.local

# DeepSeek (affordable & capable)
echo 'DEEPSEEK_API_KEY=sk-xxx' >> .env.local

# OpenAI
echo 'OPENAI_API_KEY=sk-xxx' >> .env.local

# Claude
echo 'ANTHROPIC_API_KEY=sk-ant-xxx' >> .env.local

# Qwen (Alibaba Cloud)
echo 'DASHSCOPE_API_KEY=sk-xxx' >> .env.local

# Google Gemini
echo 'GEMINI_API_KEY=xxx' >> .env.local

# Local Ollama (no key needed)
echo 'AI_REVIEW_PROVIDER=ollama' >> .env.local
```

</details>

## Install

```bash
# Project-level (recommended for teams)
npm install -D ai-review-pipeline

# Global
npm install -g ai-review-pipeline

# No install needed
npx ai-review-pipeline
```

Short alias: `ai-rp` can be used instead of `ai-review-pipeline`.

---

## Pipeline Design

### Default Mode (Review + Test + Report)

```
① AI Review (1 round, read-only)
       │
② AI Test Case Generation (functional / adversarial / edge)
       │
③ Generate HTML Report
       │
④ Exit (🔴 issues → exit 1; no 🔴 → exit 0)
```

### `--fix` Mode (Review + Fix Loop + Test + Report)

```
① AI Review (score + issue list)
       │
       ├─ Pass ──→ ④ Test
       │
       └─ Fail → ② AI Auto-fix (shows git diff)
                        │
                        └→ ③ Re-review (up to N rounds)
                                │
                                ├─ Pass → ④
                                └─ maxRounds reached → ④ (still generates test + report)

④ AI Test Case Generation
       │
⑤ Generate HTML Report
       │
⑥ Auto git commit (only on pass)
       │
⑦ Exit (pass → exit 0; fail → exit 1)
```

---

## Full Command Reference

### Commands

| Command | Description |
|---------|-------------|
| `ai-rp` | Default: Review + Test + Report (read-only) |
| `ai-rp review` | Same as default (alias) |
| `ai-rp fix` | Equivalent to `ai-rp --fix` (Review + Fix loop + Test + Report) |
| `ai-rp test` | Standalone AI test case generation |
| `ai-rp init` | Initialize config file |

### Core Options

| Option | Description |
|--------|-------------|
| `--fix` | Enable auto-fix mode (review+fix loop) |
| `--file <path>` | Target file/folder/multi-path (comma-separated) |
| `--full` | Review full file content, use with `--file` |
| `--model <name>` | Override default model (e.g. `--model gpt-4o`) |
| `--lang <zh\|en>` | Output language (default: zh) |
| `--help` / `-h` | Show help |
| `--version` / `-v` | Show version |

### Review Options

| Option | Description |
|--------|-------------|
| `--staged` | Review only git staged changes |
| `--branch <base>` | Compare branch (e.g. `main`) |
| `--json` | JSON output for CI/CD |
| `--no-report` | Skip HTML report generation |

### Fix Options

| Option | Description |
|--------|-------------|
| `--threshold <n>` | Quality threshold (default: 95, range 0-100) |
| `--max-rounds <n>` | Max fix rounds (default: 5) |
| `--no-commit` | Don't auto-commit after fix |
| `--no-test` | Skip test case generation |
| `--skip <levels>` | Skip fix levels (e.g. `green,yellow`) |

### Exit Codes

| Scenario | Code |
|----------|------|
| Review passed (no red issues, score meets threshold) | `0` |
| Review failed (red issues found) | `1` |
| `--fix` passed | `0` |
| `--fix` maxRounds exhausted, still failing | `1` (blocks CI, but report is still generated) |

### `--file` vs `--full`

```bash
# Review only git changes for that file
ai-rp --file src/utils.ts

# Review entire file content (no git changes needed)
ai-rp --file src/utils.ts --full

# No --file: review all staged / HEAD git changes
ai-rp
```

---

### `test` — AI Test Case Generation

Generate three types of test cases for target files.

| Option | Description |
|--------|-------------|
| `--file <path>` | Target file |
| `--staged` | Generate tests for staged files |

```bash
ai-rp test --file src/utils.ts
ai-rp test --staged
```

#### Three Test Types

| Type | Description |
|------|-------------|
| ✅ **Functional** | Normal flows: CRUD, state transitions, component rendering |
| ⚔️ **Adversarial** | Abnormal input: XSS, injection, authorization bypass, duplicate submission |
| 🔲 **Edge case** | Boundary conditions: null, 0, max values, timeouts |

---

### `init` — Initialize Config

```bash
ai-rp init    # Creates .ai-pipeline.json in project root
```

---

## Supported AI Providers

| Provider | Default Model | Env Var | Notes |
|----------|--------------|---------|-------|
| **OpenAI** | `gpt-4o-mini` | `OPENAI_API_KEY` | Default provider |
| **DeepSeek** | `deepseek-chat` | `DEEPSEEK_API_KEY` | Affordable & capable |
| **Claude** | `claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY` | Strong at code |
| **Qwen** | `qwen-plus` | `DASHSCOPE_API_KEY` | Alibaba Cloud |
| **Gemini** | `gemini-2.0-flash` | `GEMINI_API_KEY` | Google |
| **Ollama** | `qwen2.5-coder` | No key needed | Local, private |
| **Custom** | — | `AI_REVIEW_API_KEY` | Any OpenAI-compatible API |

### Auto-detection

The tool auto-detects your provider:
- Key starting with `sk-ant-` → Claude
- `DEEPSEEK_API_KEY` set → DeepSeek
- `ANTHROPIC_API_KEY` set → Claude
- `DASHSCOPE_API_KEY` set → Qwen
- `GEMINI_API_KEY` set → Gemini

Manual override:

```bash
# .env.local
AI_REVIEW_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-xxx

# Or custom OpenAI-compatible API
AI_REVIEW_PROVIDER=custom
AI_REVIEW_API_KEY=sk-xxx
AI_REVIEW_BASE_URL=https://your-api.com/v1
AI_REVIEW_MODEL=your-model
```

### Ollama (Local)

```bash
# 1. Install Ollama: https://ollama.com
# 2. Pull a model
ollama pull qwen2.5-coder

# 3. Configure
echo 'AI_REVIEW_PROVIDER=ollama' >> .env.local

# 4. Run
npx ai-review-pipeline --file src/utils.ts --full
```

---

## Configuration

Run `ai-rp init` to generate `.ai-pipeline.json`. Commit it to share with your team:

```jsonc
{
  "review": {
    "threshold": 95,           // Quality threshold (0-100)
    "maxRounds": 5,            // Max fix rounds in --fix mode
    "model": "",               // Override model (default: gpt-4o-mini)
    "maxDiffLines": 1500,      // Auto-truncate diff beyond this line count
    "customRules": [           // Project-specific review rules
      "No any type allowed",
      "API keys must not be hardcoded"
    ]
  },
  "fix": {
    "safetyMinRatio": 0.5      // Fixed file must be at least 50% of original (prevents truncation)
  },
  "test": {
    "stack": "auto",           // Auto-detect tech stack, or specify manually
    "maxCases": 8              // Max test cases to generate
  },
  "report": {
    "outputDir": ".ai-reports",
    "open": true               // Auto-open report after generation
  }
}
```

## Scoring

Base score: 100. Default pass threshold: 95.

| Level | Covers | Deduction |
|-------|--------|-----------|
| 🔴 Critical | Logic errors, security vulnerabilities, data risks, uncaught async errors, resource leaks / infinite loops | -20 each |
| 🟡 Warning | Unhandled edge cases, type issues, missing error handling (UX-only; escalate to 🔴 if data loss / security risk) | -5 each |
| 🟢 Info | Code duplication, unclear naming, perf hints, magic numbers / hardcoded strings, missing comments, style inconsistency | -1 each |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API Key |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `ANTHROPIC_API_KEY` | Anthropic Claude API Key |
| `DASHSCOPE_API_KEY` | Alibaba Qwen API Key |
| `GEMINI_API_KEY` | Google Gemini API Key |
| `AI_REVIEW_API_KEY` | Generic Key (highest priority, overrides all above) |
| `AI_REVIEW_PROVIDER` | Manual provider (openai/deepseek/claude/qwen/gemini/ollama/custom) |
| `AI_REVIEW_BASE_URL` | Custom API endpoint |
| `AI_REVIEW_MODEL` | Override default model |
| `HTTPS_PROXY` | HTTP proxy (requires https-proxy-agent) |

Supports `.env.local` and `.env` auto-loading. Just set the Key for your provider — the tool handles the rest.

## CI/CD Integration

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

### Git Hook (lefthook)

```yaml
# lefthook.yml
pre-push:
  commands:
    ai-review:
      run: npx ai-rp --fix --max-rounds 3
```

## package.json Scripts

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

## Cheat Sheet

```bash
# ── Default mode (Review + Test + Report, read-only) ──
ai-rp                                          # review git changes
ai-rp --file src/a.vue                         # target file
ai-rp --file src/a.vue --full                  # review full file
ai-rp --file src/views --full                  # review entire folder
ai-rp --branch main                            # compare branch
ai-rp --staged --json                          # CI mode

# ── Fix mode (Review + Auto-fix + Test + Report) ──
ai-rp --fix                                    # full fix pipeline
ai-rp fix                                      # alias
ai-rp --fix --file src/a.vue --full            # fix specific file
ai-rp fix --threshold 90 --max-rounds 3        # custom params
ai-rp fix --no-commit --skip green             # no commit, fix red+yellow only

# ── Standalone test ──
ai-rp test --file src/utils.ts                 # generate tests
ai-rp test --staged                            # staged file tests

# ── Init ──
ai-rp init                                     # generate config file
```

## License

MIT
