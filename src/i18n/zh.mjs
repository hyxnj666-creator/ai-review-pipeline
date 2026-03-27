export default {
  noApiKey: '缺少 API Key，请配置对应环境变量（支持 .env.local）:\n  OpenAI:   OPENAI_API_KEY\n  DeepSeek: DEEPSEEK_API_KEY\n  Claude:   ANTHROPIC_API_KEY\n  通义千问: DASHSCOPE_API_KEY\n  Gemini:   GEMINI_API_KEY\n  通用:     AI_REVIEW_API_KEY',
  noChanges: '没有检测到代码变更。',
  diffLines: (n, label, trunc) => `检测到 ${n} 行变更（${label}）${trunc ? '，已截断' : ''}`,
  provider: (p) => `Provider: ${p}`,
  model: (m) => `模型: ${m}`,
  threshold: (t) => `阈值: ${t}`,
  maxRounds: (n) => `最大轮次: ${n}`,
  mode: (m) => `模式: ${m}`,
  target: (t) => `目标: ${t}`,
  modeReviewOnly: 'Review-only（只读）',
  modeFix: 'Review + 自动修复',
  modeDryRun: 'Dry-run（出报告，不修改不阻断）',
  roundTitle: (n) => `第 ${n} 轮 Code Review`,
  score: (s, r, y, g) => `质量评分: ${s}/100 | 🔴${r} 🟡${y} 🟢${g}`,
  passed: (s, t) => `质量达标（${s} ≥ ${t}），Review 通过！`,
  reviewOnlyHint: 'Review-only 模式：以上问题需要开发者手动修复。',
  fixHint: '如需自动修复，请使用 fix 命令。',
  dryRunSkip: 'Dry-run 模式：跳过修复，继续生成测试和报告。',
  maxRoundsReached: (n) => `已达最大轮次 ${n}，停止自动修复。`,
  fixRound: (n) => `第 ${n} 轮自动修复`,
  fixSafetyNote: '自动修复只处理代码质量问题，不改变功能逻辑。',
  fixFile: (f, n) => `修复 ${f}（${n} 个问题）...`,
  fixDone: (f) => `${f} 已修复`,
  fixFail: (f) => `${f} 修复失败，需人工处理`,
  fixTooShort: (f, r) => `${f} 修复结果过短（低于原文件 ${r}%），跳过`,
  fixCount: (n) => `本轮修复 ${n} 个文件。`,
  fixDiffTitle: '本轮修复内容（git diff）',
  noFixNeeded: '无需修复的问题。',
  nextRound: '进入下一轮 Review...',
  testTitle: 'AI 测试用例生成',
  testTarget: (f) => `目标文件: ${f}`,
  testNoFiles: '没有变更的代码文件，跳过测试生成。',
  reportGenerated: (p) => `报告已生成: ${p}`,
  commitTitle: '自动提交',
  commitDone: (m) => `已提交: ${m}`,
  commitFail: (e) => `提交失败: ${e}`,
  pipelineTitle: 'AI 自动化质量流水线',
  resultPass: '通过',
  resultFail: '未通过',
  resultDryRun: '报告已生成（dry-run 不阻断）',
  finalScore: (s) => `最终评分: ${s}/100`,
  finalRounds: (n) => `执行轮次: ${n}`,
  finalReport: (p) => `报告: ${p}`,
  dryRunDone: 'Dry-run 完成，代码未做任何修改，可放心提交。',
  fixSuggest: '如需自动修复，请运行: ai-rp fix',
  reviewOnlySuggest: '当前为 Review-only 模式。如需自动修复请运行: ai-rp fix',
  manualSuggest: '建议：人工检查剩余问题后重新运行，或加大 --max-rounds',
  autoCommit: (v) => `自动提交: ${v ? '是' : '否'}`,
  autoTest: (v) => `生成测试: ${v ? '是' : '否'}`,
  initCreated: (p) => `配置文件已生成: ${p}`,
  initExists: (p) => `配置文件已存在: ${p}，跳过。`,
  initDone: '初始化完成！可编辑 .ai-pipeline.json 自定义审查规则。',
  testDetectStack: (s) => `检测技术栈: ${s}`,
  testCodeLen: (n) => `代码长度: ${n} 行`,
  testGenerating: '正在调用 AI 生成测试用例...',
  reviewTitle: 'AI Code Review 报告',
  reviewResult: (pass) => `结果: ${pass ? '✅ PASS' : '❌ BLOCKED（存在阻塞问题）'}`,
  reviewTime: (s) => `耗时: ${s}s`,
  tokens: (p, c, t) => `Tokens: ${p}+${c}=${t}`,
  helpText: `
ai-review-pipeline — AI 驱动的代码质量流水线

命令:
  review    AI Code Review（只读，不修改代码）
  fix       Review + 自动修复 + 测试 + 提交流水线
  test      AI 测试用例生成
  init      初始化配置文件（.ai-pipeline.json）

通用参数:
  --file <path>       指定文件/文件夹/多目标（逗号分隔）
  --full              配合 --file 使用，审查完整文件（不依赖 git diff）
  --dry-run           出报告不阻断，不修改代码，所有命令通用
  --lang <zh|en>      输出语言（默认中文）
  --help              显示帮助
  --version           显示版本

review 参数:
  --staged            Review staged 改动
  --branch <base>     对比分支（如 main）
  --json              JSON 输出（CI 用）
  --no-report         不生成 HTML 报告

fix 参数:
  --threshold <n>     质量阈值（默认 95）
  --max-rounds <n>    最大修复轮次（默认 3）
  --no-commit         修复后不自动提交
  --no-test           跳过测试用例生成
  --skip <levels>     跳过修复级别（如 green,yellow）

test 参数:
  --staged            为 staged 文件生成测试

--file 与 --full 的区别:
  --file src/a.vue          只 review 该文件的 git 改动部分
  --file src/a.vue --full   review 完整文件内容（无需 git 改动）

支持的 AI Provider:
  openai      OpenAI（默认）         OPENAI_API_KEY
  deepseek    DeepSeek              DEEPSEEK_API_KEY
  claude      Anthropic Claude      ANTHROPIC_API_KEY
  qwen        通义千问              DASHSCOPE_API_KEY
  gemini      Google Gemini         GEMINI_API_KEY
  ollama      本地 Ollama           无需 Key
  custom      自定义 OpenAI 兼容    AI_REVIEW_API_KEY + AI_REVIEW_BASE_URL

  自动识别 Provider（根据 Key 前缀或 Base URL），也可手动指定:
  AI_REVIEW_PROVIDER=deepseek

示例:
  npx ai-rp review --file src/utils.ts              # 只看 git 改动
  npx ai-rp review --file src/utils.ts --full       # 审查完整文件
  npx ai-rp review --dry-run --file src/ --full     # 审查整个文件夹
  npx ai-rp fix --dry-run --file src/views --full   # 完整审查+报告
  npx ai-rp fix --threshold 90
  npx ai-rp test --file src/utils.ts
  npx ai-rp init
`.trim(),
};
