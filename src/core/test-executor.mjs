import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { callAI } from './ai-client.mjs';

const CODE_EXT = /\.(ts|tsx|vue|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|rb|php|cs|uvue)$/i;
const SKIP_DIRS = ['node_modules', '.git', 'dist', '.next', '.nuxt', '.output', 'build', 'coverage', '.ai-reports', '.ai-tests'];

export function collectCodeFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.includes(entry.name)) results.push(...collectCodeFiles(full));
    } else if (CODE_EXT.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

export function detectStack(code, file) {
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

export function buildSourceFromFiles(files, { maxLinesPerFile = 200 } = {}) {
  const codeFiles = files.filter((f) => existsSync(resolve(process.cwd(), f)));
  if (codeFiles.length === 0) return { files: [], sourceCode: '', fileLabel: '' };

  const sourceCode = codeFiles.map((f) => {
    const code = readFileSync(resolve(process.cwd(), f), 'utf-8');
    const lines = code.split('\n');
    const truncated = lines.length > maxLinesPerFile ? `${lines.slice(0, maxLinesPerFile).join('\n')}\n// ...` : code;
    return `// ===== ${f} =====\n${truncated}`;
  }).join('\n\n');

  return { files: codeFiles, sourceCode, fileLabel: codeFiles.join(', ') };
}

function buildImportGuide(targetFiles, tempDir) {
  const tempBase = resolve(process.cwd(), tempDir || '.ai-tests', '__temp__.test.ts');
  return targetFiles.map((file) => {
    const abs = resolve(process.cwd(), file);
    let rel = relative(dirname(tempBase), abs).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    rel = rel.replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, '');
    return `- ${file} -> ${rel}`;
  }).join('\n');
}

function buildPrompt({ sourceCode, fileLabel, stack, maxCases, targetFiles, tempDir, lang = 'zh' }) {
  const importGuide = buildImportGuide(targetFiles, tempDir);
  if (lang === 'en') {
    return `You are a senior test engineer. Generate runnable tests for the following code. Stack: ${stack}.

## Test case categories

### 1. Functional cases
Normal business flows: CRUD, state changes, data transforms, component rendering, expected API behavior.

### 2. Adversarial cases
Abnormal input: XSS, injection, long strings, invalid characters, duplicate submission, authorization bypass.

### 3. Edge cases
null/undefined, empty arrays/objects, 0/negative/MAX_SAFE_INTEGER, first/last page, timeout/network failure.

## Output format

List key test ideas briefly, then output ${maxCases} runnable tests in one final fenced code block.
The final code block must contain only test code for ${stack}. Do not include explanations after the final code block.

## Important constraints

- The generated test file will be written under ${tempDir || '.ai-tests'} at the repo root
- Use relative imports that work from that temp file location
- Prefer importing only the changed source modules instead of unrelated files
- For Vitest tests, explicitly import the test APIs you use from 'vitest' (for example: describe, it/test, expect, vi). Do not assume globals are enabled.
- For Jest tests, explicitly import the test APIs you use from '@jest/globals'. Do not assume globals are enabled.
- If you need imports, prefer these exact paths:
${importGuide}

## Source code

Files: ${fileLabel}

\`\`\`
${sourceCode}
\`\`\``;
  }

  return `你是一个资深测试工程师。请根据以下代码，生成覆盖完整的测试用例。技术栈: ${stack}。

## 测试用例分三类

### 1. 功能用例（验证业务正确性）
正常业务流程：CRUD 操作、状态流转、数据变换、组件渲染、API 调用是否返回预期结果。

### 2. 对抗用例（验证安全与健壮性）
恶意或异常输入：XSS 注入、SQL 注入、超长字符串、非法字符、并发重复提交、越权访问。

### 3. 边界用例（验证边界条件）
边界值与极端场景：空值/null/undefined、空数组/空对象、数值 0/负数/MAX_SAFE_INTEGER、分页首页和末页、网络超时/断网。

## 输出格式

先简要列出关键测试点，最后输出 ${maxCases} 个关键用例的可运行测试代码，并且把最终测试代码放在一个单独的代码块中。
最后那个代码块里只能放 ${stack} 风格的测试代码，后面不要再追加解释。

## 重要约束

- 生成出来的测试文件会写到仓库根目录下的 ${tempDir || '.ai-tests'} 目录
- 你的 import 必须从这个临时测试文件位置出发，保证相对路径可以直接运行
- 优先只 import 当前变更涉及的源文件，不要引用无关模块
- 如果生成的是 Vitest 测试，请显式从 'vitest' 导入你用到的测试 API（如 describe、it/test、expect、vi），不要假设项目开启了 globals
- 如果生成的是 Jest 测试，请显式从 '@jest/globals' 导入你用到的测试 API，不要假设项目开启了 globals
- 如需导入，请优先直接使用这些相对路径：
${importGuide}

## 源代码

文件: ${fileLabel}

\`\`\`
${sourceCode}
\`\`\``;
}

export async function generateTestDraft({ sourceCode, fileLabel, targetFiles, env, model, config, lang = 'zh' }) {
  const stack = config.test.stack !== 'auto' ? config.test.stack : detectStack(sourceCode, fileLabel);
  const prompt = buildPrompt({
    sourceCode,
    fileLabel,
    stack,
    maxCases: config.test.maxCases || 8,
    targetFiles,
    tempDir: config.test.tempDir,
    lang,
  });
  const startedAt = Date.now();
  const { content, tokens } = await callAI({
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    model,
    prompt,
    temperature: Number(config.test.temperature ?? 0.4),
    maxTokens: Number(config.test.maxTokens ?? 12288),
    provider: env.provider,
  });

  return {
    stack,
    prompt,
    content,
    tokens,
    elapsedMs: Date.now() - startedAt,
  };
}

export function extractRunnableTestCode(content) {
  const blocks = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    const lang = String(match[1] || '').trim().toLowerCase();
    const code = match[2].trim();
    if (code) blocks.push({ lang, code });
  }

  const scoreBlock = (block) => {
    let score = 0;
    if (/(ts|tsx|js|jsx|javascript|typescript|test)/.test(block.lang)) score += 5;
    if (/(describe|it|test)\s*\(|expect\s*\(|render\s*\(|screen\.|vi\.|jest\./.test(block.code)) score += 6;
    if (/\bimport\b|\brequire\s*\(/.test(block.code)) score += 2;
    if (/(json|diff|md|markdown|bash|shell|sh|yaml)/.test(block.lang)) score -= 5;
    if (/\[类型\]|输入:|预期:|操作:|Functional cases|Adversarial cases|Edge cases/.test(block.code)) score -= 3;
    score += Math.min(4, Math.floor(block.code.length / 400));
    return score;
  };

  if (blocks.length > 0) {
    const best = [...blocks].sort((a, b) => scoreBlock(b) - scoreBlock(a) || b.code.length - a.code.length)[0];
    if (scoreBlock(best) > 0) return best.code;
  }

  if (/(describe|it|test)\s*\(|expect\s*\(/.test(content)) return content.trim();
  return '';
}

function collectUsedTestApis(code, names) {
  return names.filter((name) => new RegExp(`\\b${name}\\b`).test(code));
}

function injectFrameworkImport(code, moduleName, names) {
  const used = collectUsedTestApis(code, names);
  if (used.length === 0) return code;

  const existingImport = new RegExp(`from\\s+['"]${moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
  if (existingImport.test(code)) return code;

  const importLine = `import { ${used.join(', ')} } from '${moduleName}';`;
  const lines = code.split('\n');
  let insertAt = 0;
  while (insertAt < lines.length && /^\s*import\b/.test(lines[insertAt])) insertAt += 1;
  lines.splice(insertAt, 0, importLine);
  return lines.join('\n');
}

function normalizeTestCodeForRunner(code, runner) {
  if (!code) return code;
  if (runner === 'vitest') {
    return injectFrameworkImport(code, 'vitest', ['describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'vi']);
  }
  if (runner === 'jest') {
    return injectFrameworkImport(code, '@jest/globals', ['describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'jest']);
  }
  return code;
}

function chooseTempExtension(targetFiles, code) {
  const exts = targetFiles.map((f) => extname(f).toLowerCase());
  if (exts.some((ext) => ext === '.tsx' || ext === '.jsx' || ext === '.vue') || /<[A-Z][\w.]*/.test(code)) return 'tsx';
  if (exts.some((ext) => ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs')) return 'js';
  return 'ts';
}

function sanitizeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'generated';
}

function detectRunner(cwd, commandOverride = '') {
  if (commandOverride) return { runner: 'custom', command: commandOverride, source: 'config' };

  const pkgPath = resolve(cwd, 'package.json');
  if (!existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const scripts = pkg.scripts || {};
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const scriptText = Object.values(scripts).join('\n');

    if ('vitest' in deps || /\bvitest\b/.test(scriptText)) {
      return { runner: 'vitest', command: 'npx vitest run "{file}" --reporter=basic', source: 'package.json' };
    }
    if ('jest' in deps || 'ts-jest' in deps || /\bjest\b/.test(scriptText)) {
      return { runner: 'jest', command: 'npx jest "{file}" --runInBand', source: 'package.json' };
    }
  } catch {
    return null;
  }

  return null;
}

function buildCommand(template, relativeFile) {
  if (template.includes('{file}')) return template.replaceAll('{file}', relativeFile);
  return template;
}

function trimOutput(text, maxChars = 12000) {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n... (truncated)`;
}

function cleanupTempFile(tempFile, tempDir) {
  try { rmSync(tempFile, { force: true }); } catch { /* ignore */ }
  try {
    if (existsSync(tempDir) && readdirSync(tempDir).length === 0) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } catch { /* ignore */ }
}

export function executeGeneratedTests({ code, targetFiles, config, cwd = process.cwd() }) {
  const runner = detectRunner(cwd, config.test.command || '');
  if (!runner) {
    return {
      attempted: false,
      passed: false,
      skipped: true,
      reason: 'No Vitest/Jest runner detected. Set test.command to override.',
      runner: '',
      command: '',
      exitCode: null,
      stdout: '',
      stderr: '',
      elapsedMs: 0,
      tempFile: '',
      keptFile: false,
    };
  }

  const normalizedCode = normalizeTestCodeForRunner(code, runner.runner);
  const tempDir = resolve(cwd, config.test.tempDir || '.ai-tests');
  mkdirSync(tempDir, { recursive: true });
  const seed = sanitizeName(basename(targetFiles[0] || 'generated', extname(targetFiles[0] || '')));
  const ext = chooseTempExtension(targetFiles, normalizedCode);
  const tempFile = resolve(tempDir, `${seed}.ai-rp.test.${ext}`);
  writeFileSync(tempFile, normalizedCode, 'utf-8');

  const relativeFile = relative(cwd, tempFile).replace(/\\/g, '/');
  const command = buildCommand(runner.command, relativeFile);
  const startedAt = Date.now();
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf-8',
    timeout: Number(config.test.timeoutMs ?? 120000),
    maxBuffer: 5 * 1024 * 1024,
  });
  const elapsedMs = Date.now() - startedAt;
  const timedOut = result.error?.code === 'ETIMEDOUT';
  const passed = result.status === 0 && !timedOut;
  const keepFailed = config.test.keepFailed !== false;

  if (passed || !keepFailed) {
    cleanupTempFile(tempFile, tempDir);
  }

  return {
    attempted: true,
    passed,
    skipped: false,
    reason: timedOut ? `Test command timed out after ${config.test.timeoutMs || 120000}ms.` : '',
    runner: runner.runner,
    command,
    exitCode: result.status,
    stdout: trimOutput(result.stdout || ''),
    stderr: trimOutput(result.stderr || (timedOut ? String(result.error?.message || '') : '')),
    elapsedMs,
    tempFile: relativeFile,
    keptFile: !passed && keepFailed,
  };
}

export async function runAiTestPipeline({ sourceCode, fileLabel, targetFiles, env, model, config, lang = 'zh', runTests = true }) {
  const generated = await generateTestDraft({ sourceCode, fileLabel, targetFiles, env, model, config, lang });
  const code = extractRunnableTestCode(generated.content);

  const execution = runTests && code
    ? executeGeneratedTests({ code, targetFiles, config })
    : {
        attempted: false,
        passed: false,
        skipped: true,
        reason: code ? 'Real test execution disabled.' : 'No runnable test code extracted from AI output.',
        runner: '',
        command: '',
        exitCode: null,
        stdout: '',
        stderr: '',
        elapsedMs: 0,
        tempFile: '',
        keptFile: false,
      };

  return {
    stack: generated.stack,
    output: generated.content,
    code,
    tokens: generated.tokens,
    elapsedMs: generated.elapsedMs,
    execution,
  };
}
