const CODE_FILE_RE = /\.(ts|tsx|vue|js|jsx|mjs|cjs|go|rs|java|kt|swift|rb|php|cs|uvue)$/i;

function calcScore(red, yellow, green, blue = 0) {
  return Math.max(0, 100 - red * 20 - yellow * 5 - green * 1);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDiff(diff) {
  const files = [];
  let current = null;
  let newLine = 0;

  for (const rawLine of diff.split('\n')) {
    if (rawLine.startsWith('diff --git ')) {
      const match = rawLine.match(/ b\/(.+)$/);
      current = {
        file: match?.[1] || '',
        lines: [],
      };
      files.push(current);
      newLine = 0;
      continue;
    }

    if (!current) continue;

    if (rawLine.startsWith('+++ b/')) {
      current.file = rawLine.slice(6);
      newLine = 1;
      continue;
    }

    const hunk = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      newLine = Number(hunk[1]);
      current.lines.push({ type: 'hunk', raw: rawLine, line: newLine });
      continue;
    }

    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      current.lines.push({ type: 'add', raw: rawLine, text: rawLine.slice(1), line: newLine });
      newLine += 1;
      continue;
    }

    if (rawLine.startsWith(' ') || (!rawLine.startsWith('-') && !rawLine.startsWith('---'))) {
      current.lines.push({
        type: rawLine.startsWith(' ') ? 'context' : 'plain',
        raw: rawLine,
        text: rawLine.startsWith(' ') ? rawLine.slice(1) : rawLine,
        line: newLine,
      });
      newLine += 1;
      continue;
    }

    if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      current.lines.push({ type: 'del', raw: rawLine, text: rawLine.slice(1), line: newLine });
    }
  }

  return files.filter((file) => CODE_FILE_RE.test(file.file));
}

function isSecretLine(text) {
  return /(sk-(proj-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z\-_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA|DSA|EC|OPENSSH|PRIVATE) KEY-----|xox[baprs]-[A-Za-z0-9-]{10,})/.test(text);
}

function isUnsafeHtmlSink(text) {
  return /(dangerouslySetInnerHTML|innerHTML\s*=|outerHTML\s*=|v-html\s*=)/.test(text);
}

function getGuardWindow(lines, index) {
  return lines
    .slice(Math.max(0, index - 3), index + 1)
    .map((line) => line.text || '')
    .join('\n');
}

function isGuardedCollectionAccess(expr, windowText) {
  if (expr.includes('?.')) return true;
  const escaped = escapeRegExp(expr);
  const patterns = [
    new RegExp(`${escaped}\\s*&&`),
    new RegExp(`${escaped}\\?\\.`),
    new RegExp(`Array\\.isArray\\(\\s*${escaped}\\s*\\)`),
    new RegExp(`${escaped}\\s*!==?\\s*(null|undefined)`),
    new RegExp(`${escaped}\\s*!=\\s*null`),
    new RegExp(`${escaped}\\s*\\?`),
  ];
  return patterns.some((pattern) => pattern.test(windowText));
}

function detectCollectionAccess(text) {
  const directCollection = text.match(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\.(map|filter|reduce|forEach|some|every|find)\s*\(/);
  if (directCollection) return directCollection[1];

  const objectHelpers = text.match(/Object\.(keys|values|entries)\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*\)/);
  if (objectHelpers) return objectHelpers[2];

  const lengthAccess = text.match(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\.length\b/);
  if (lengthAccess && !text.includes('?.length')) return lengthAccess[1];

  return '';
}

function buildIssue({ file, line, severity, title, desc, fix, code }) {
  return { file, line, severity, title, desc, fix, code };
}

export function runRuleChecks(diff, lang = 'zh') {
  const files = parseDiff(diff);
  const issues = [];
  const seen = new Set();

  for (const file of files) {
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i];
      if (line.type !== 'add') continue;
      const text = line.text || '';
      const windowText = getGuardWindow(file.lines, i);

      if (isSecretLine(text)) {
        const key = `secret::${file.file}::${line.line}`;
        if (!seen.has(key)) {
          seen.add(key);
          issues.push(buildIssue({
            file: file.file,
            line: line.line,
            severity: 'red',
            title: lang === 'en' ? 'Hardcoded secret detected' : '检测到敏感信息硬编码',
            desc: lang === 'en'
              ? 'A credential-like string was added directly in code, which may leak secrets.'
              : '代码中直接出现了疑似凭证/密钥字符串，存在敏感信息泄露风险。',
            fix: lang === 'en'
              ? 'Move the secret to environment variables or a secure secret manager.'
              : '请将敏感信息迁移到环境变量或密钥管理系统中。',
            code: text.trim(),
          }));
        }
      }

      if (isUnsafeHtmlSink(text)) {
        const key = `html::${file.file}::${line.line}`;
        if (!seen.has(key)) {
          seen.add(key);
          issues.push(buildIssue({
            file: file.file,
            line: line.line,
            severity: 'red',
            title: lang === 'en' ? 'Unsafe HTML sink detected' : '检测到不安全的 HTML 注入点',
            desc: lang === 'en'
              ? 'An unsafe HTML sink was introduced, which may enable XSS if fed with untrusted input.'
              : '代码中出现了不安全的 HTML 注入点，若输入不可信数据，可能导致 XSS。',
            fix: lang === 'en'
              ? 'Avoid unsafe HTML rendering or ensure the content is strictly sanitized and trusted.'
              : '避免使用不安全的 HTML 渲染方式，或确保输入内容经过严格清洗且来源可信。',
            code: text.trim(),
          }));
        }
      }

      const expr = detectCollectionAccess(text);
      if (expr && !isGuardedCollectionAccess(expr, windowText)) {
        const key = `collection::${file.file}::${expr}`;
        if (!seen.has(key)) {
          seen.add(key);
          issues.push(buildIssue({
            file: file.file,
            line: line.line,
            severity: 'yellow',
            title: lang === 'en' ? 'Potential missing null check before collection access' : '集合访问前可能缺少判空检查',
            desc: lang === 'en'
              ? `The code accesses ${expr} as a collection/length without an obvious nearby guard, which may throw at runtime.`
              : `代码对 ${expr} 做了集合/长度访问，但附近没有明显的判空或类型保护，可能导致运行时错误。`,
            fix: lang === 'en'
              ? `Check ${expr} before access, or use optional chaining / Array.isArray guards where appropriate.`
              : `在访问 ${expr} 前增加判空或类型保护，必要时使用可选链或 Array.isArray 检查。`,
            code: text.trim(),
          }));
        }
      }
    }
  }

  const red = issues.filter((issue) => issue.severity === 'red').length;
  const yellow = issues.filter((issue) => issue.severity === 'yellow').length;
  const green = issues.filter((issue) => issue.severity === 'green').length;
  const blue = issues.filter((issue) => issue.severity === 'blue').length;
  const score = calcScore(red, yellow, green, blue);
  const summary = issues.length === 0
    ? ''
    : lang === 'en'
      ? `Rule engine detected ${issues.length} deterministic risk issue(s).`
      : `规则引擎命中了 ${issues.length} 个确定性风险问题。`;

  return {
    score,
    red,
    yellow,
    green,
    blue,
    summary,
    issues,
    markdown: '',
    parseError: false,
  };
}
