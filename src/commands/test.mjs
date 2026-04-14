import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { loadEnv } from '../core/env.mjs';
import { loadConfig, getEnvConfig } from '../core/config.mjs';
import { initProxy, callAI } from '../core/ai-client.mjs';
import { log, separator, t } from '../core/logger.mjs';

function detectStack(code, file) {
  const ext = extname(file).toLowerCase();
  if (ext === '.py') return 'Python (pytest)';
  if (ext === '.vue') return 'Vue3 (Vitest)';
  if (code.includes('from react') || code.includes("from 'react")) return 'React (Vitest/Jest)';
  if (ext === '.tsx' || ext === '.jsx') return 'React (Vitest)';
  if (ext === '.go') return 'Go (testing)';
  if (ext === '.rs') return 'Rust (cargo test)';
  if (ext === '.java') return 'Java (JUnit)';
  return 'TypeScript (Vitest)';
}

export async function run(args) {
  loadEnv();
  const config = loadConfig();
  const env = getEnvConfig();
  const cliModel = args.includes('--model') ? args[args.indexOf('--model') + 1] : '';
  const model = cliModel || config.review.model || env.model;

  if (!env.apiKey && env.provider !== 'ollama') { console.error(`❌ ${t('noApiKey')}`); process.exit(1); }

  await initProxy(env.proxy);

  const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
  const staged = args.includes('--staged');

  let sourceCode = '';
  let fileName = '';

  if (file) {
    const fullPath = resolve(process.cwd(), file);
    if (!existsSync(fullPath)) { console.error(`❌ File not found: ${file}`); process.exit(1); }
    sourceCode = readFileSync(fullPath, 'utf-8');
    fileName = file;
  } else if (staged) {
    try {
      const files = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf-8' })
        .trim().split('\n').filter(Boolean)
        .filter((f) => /\.(ts|tsx|vue|js|jsx|py|go|rs|java)$/.test(f));
      if (files.length === 0) { console.log(`✅ ${t('testNoFiles')}`); process.exit(0); }
      sourceCode = files.map((f) => {
        try { return `// ===== ${f} =====\n${readFileSync(resolve(process.cwd(), f), 'utf-8')}`; }
        catch { return ''; }
      }).filter(Boolean).join('\n\n');
      fileName = files.join(', ');
    } catch { console.error('❌ Failed to get staged files'); process.exit(1); }
  } else {
    console.error('Usage: ai-rp test --file <path> or --staged');
    process.exit(1);
  }

  if (!sourceCode.trim()) { console.log(`✅ ${t('noChanges')}`); process.exit(0); }

  const MAX_CHARS = 50000;
  if (sourceCode.length > MAX_CHARS) {
    sourceCode = sourceCode.slice(0, MAX_CHARS) + '\n\n... (truncated)';
  }

  const stack = config.test.stack !== 'auto' ? config.test.stack : detectStack(sourceCode, fileName);
  const maxCases = config.test.maxCases || 8;

  log('📝', t('testTarget', fileName));
  log('🔧', t('testDetectStack', stack));
  log('📏', t('testCodeLen', sourceCode.split('\n').length));
  console.log();
  log('⏳', t('testGenerating'));

  const prompt = `你是一个资深测试工程师。请根据以下代码，生成覆盖完整的测试用例。技术栈: ${stack}。

## 测试用例分三类

### 1. ✅ 功能用例（验证业务正确性）
正常业务流程：CRUD 操作、状态流转、数据变换、组件渲染、API 调用是否返回预期结果。

### 2. ⚔️ 对抗用例（验证安全与健壮性）
恶意或异常输入：XSS 注入、SQL 注入、超长字符串、非法字符、并发重复提交、越权访问。

### 3. 🔲 边界用例（验证边界条件）
边界值与极端场景：空值/null/undefined、空数组/空对象、数值 0/负数/MAX_SAFE_INTEGER、分页首页和末页、网络超时/断网。

## 输出格式

每条用例：
\`\`\`
[类型] 用例名称
  输入: 具体输入数据
  操作: 具体操作步骤
  预期: 预期结果
\`\`\`

最后输出 ${maxCases} 个关键用例的**可运行测试代码**（${stack} 风格）。

## 源代码

文件: ${fileName}

\`\`\`
${sourceCode}
\`\`\``;

  const t0 = Date.now();
  const { content, tokens } = await callAI({ baseUrl: env.baseUrl, apiKey: env.apiKey, model, prompt, temperature: 0.4, provider: env.provider });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  separator(t('testTitle'));
  console.log(content);
  console.log();
  console.log('─'.repeat(60));
  log('⏱️', `${t('model', model)} | ${t('reviewTime', elapsed)}${tokens ? ` | ${t('tokens', tokens.prompt_tokens, tokens.completion_tokens, tokens.total_tokens)}` : ''}`);
  console.log('═'.repeat(60));
}

export { detectStack };
