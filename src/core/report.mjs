import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { execSync } from 'node:child_process';

function escHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const JS_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue']);

function findBodyBraces(source, offset) {
  let parenDepth = 0;
  let angleDepth = 0;
  let braceDepth = 0;
  let bodyStart = -1;
  let inString = '';

  for (let i = offset; i < source.length; i++) {
    const ch = source[i];
    const prev = i > 0 ? source[i - 1] : '';

    if (inString) {
      if (ch === inString && prev !== '\\') inString = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i + 2); if (i < 0) break; i++; continue; }

    if (ch === '(') { parenDepth++; continue; }
    if (ch === ')') { parenDepth--; continue; }
    if (ch === '<' && parenDepth === 0 && braceDepth === 0) { angleDepth++; continue; }
    if (ch === '>' && angleDepth > 0) { angleDepth--; continue; }

    if (parenDepth > 0 || angleDepth > 0) continue;

    if (ch === '{') {
      braceDepth++;
      if (bodyStart < 0) bodyStart = i;
    } else if (ch === '}') {
      braceDepth--;
      if (braceDepth === 0 && bodyStart >= 0) {
        return { bodyStart, bodyEnd: i };
      }
    }
  }
  return null;
}

function extractScopes(source) {
  const scopes = [];
  const SCOPE_RE = /(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\(|[a-zA-Z_$]\w*\s*=>))|(?:class\s+(\w+))/g;
  let m;
  while ((m = SCOPE_RE.exec(source)) !== null) {
    const name = m[1] || m[2] || m[3];
    if (!name) continue;
    const startLine = source.slice(0, m.index).split('\n').length;
    const braces = findBodyBraces(source, m.index + m[0].length);
    if (!braces) continue;
    const endLine = source.slice(0, braces.bodyEnd + 1).split('\n').length;
    scopes.push({ name, startLine, endLine, kind: m[3] ? 'class' : 'function' });
  }
  return scopes;
}

function findScopeForLine(scopes, line) {
  let best = null;
  for (const s of scopes) {
    if (line >= s.startLine && line <= s.endLine) {
      if (!best || (s.endLine - s.startLine) < (best.endLine - best.startLine)) best = s;
    }
  }
  return best;
}

function findScopeByContent(scopes, lines, issue) {
  const needles = extractSearchNeedles(issue);
  for (const needle of needles) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(needle)) {
        const lineNum = i + 1;
        const scope = findScopeForLine(scopes, lineNum);
        if (scope) return { scope, matchLine: lineNum };
      }
    }
  }
  return null;
}

const HL_KEYWORDS = new Set([
  'const','let','var','function','return','if','else','for','while','do','switch','case','break',
  'continue','new','delete','typeof','instanceof','in','of','class','extends','super','this',
  'import','export','from','default','async','await','try','catch','finally','throw',
  'true','false','null','undefined','void','yield','static','get','set',
  'def','self','elif','None','True','False','print','raise','with','as','lambda','pass',
  'interface','type','enum','implements','abstract','private','public','protected','readonly',
]);

function highlightCode(raw) {
  const TOKEN_RE = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|(?<=^|[\s;{(])#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+\.?\d*\b)|(\b[A-Za-z_$]\w*\b)/g;
  let result = '';
  let last = 0;
  let m;
  while ((m = TOKEN_RE.exec(raw)) !== null) {
    if (m.index > last) result += escHtml(raw.slice(last, m.index));
    const [match, comment, str, num, word] = m;
    if (comment) result += `<span class="hl-c">${escHtml(comment)}</span>`;
    else if (str) result += `<span class="hl-s">${escHtml(str)}</span>`;
    else if (num) result += `<span class="hl-n">${escHtml(num)}</span>`;
    else if (word && HL_KEYWORDS.has(word)) result += `<span class="hl-k">${escHtml(word)}</span>`;
    else result += escHtml(match);
    last = m.index + match.length;
  }
  if (last < raw.length) result += escHtml(raw.slice(last));
  return result;
}

function extractSearchNeedles(issue) {
  const needles = [];
  if (issue.code) {
    for (const raw of issue.code.trim().split('\n')) {
      const l = raw.trim();
      if (l.length >= 6) needles.push(l);
    }
  }
  const combined = `${issue.title || ''} ${issue.desc || ''} ${issue.fix || ''}`;
  const strLiterals = combined.match(/[""`']([^"'`""]{4,})[""`']/g);
  if (strLiterals) {
    for (const s of strLiterals) needles.push(s.slice(1, -1).trim());
  }
  const identifiers = combined.match(/`([A-Za-z_$][\w$.]*(?:\.\w+)*)`/g);
  if (identifiers) {
    for (const id of identifiers) needles.push(id.slice(1, -1));
  }
  const KEYWORD_RE = /\b(innerHTML|dangerouslySetInnerHTML|v-html|eval\s*\(|document\.write|\.exec\(|password|secret|token|api[_-]?key|credentials|hardcod)/i;
  const kwMatch = combined.match(KEYWORD_RE);
  if (kwMatch) needles.push(kwMatch[1]);
  return needles;
}

function locateInFile(lines, aiLine, issue) {
  const needles = extractSearchNeedles(issue);
  for (const needle of needles) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(needle)) return i + 1;
    }
  }
  if (typeof aiLine === 'number' && aiLine > 0 && aiLine <= lines.length) return aiLine;
  return 0;
}

function renderSnippetLines(lines, start, end, highlightLine) {
  return lines.slice(start, end).map((l, idx) => {
    const num = start + idx + 1;
    const isTarget = num === highlightLine;
    const numStr = String(num).padStart(4);
    const highlighted = highlightCode(l);
    const cls = isTarget ? ' class="hl-target"' : '';
    return `<span${cls}><span class="hl-ln">${numStr}</span> │ ${highlighted}</span>`;
  }).join('\n');
}

function getCodeSnippetHTML(file, issue, contextLines = 8) {
  if (!file) return { html: '', scopeName: '' };
  try {
    const fullPath = resolve(process.cwd(), file);
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const ext = extname(file).toLowerCase();
    const isJS = JS_EXTS.has(ext);

    if (isJS) {
      const scopes = extractScopes(content);
      if (scopes.length > 0) {
        const byContent = findScopeByContent(scopes, lines, issue);
        if (byContent) {
          const { scope, matchLine } = byContent;
          const start = Math.max(0, scope.startLine - 1);
          const end = Math.min(lines.length, scope.endLine);
          const html = renderSnippetLines(lines, start, end, matchLine);
          return { html, scopeName: `${scope.kind === 'class' ? 'class' : 'fn'} ${scope.name}()` };
        }
        const aiLine = typeof issue.line === 'number' ? issue.line : parseInt(issue.line, 10);
        if (aiLine > 0) {
          const scope = findScopeForLine(scopes, aiLine);
          if (scope) {
            const start = Math.max(0, scope.startLine - 1);
            const end = Math.min(lines.length, scope.endLine);
            const html = renderSnippetLines(lines, start, end, aiLine);
            return { html, scopeName: `${scope.kind === 'class' ? 'class' : 'fn'} ${scope.name}()` };
          }
        }
      }
    }

    const realLine = locateInFile(lines, issue.line, issue);
    if (realLine <= 0) return { html: '', scopeName: '' };
    const start = Math.max(0, realLine - contextLines - 1);
    const end = Math.min(lines.length, realLine + contextLines);
    const html = renderSnippetLines(lines, start, end, realLine);
    return { html, scopeName: '' };
  } catch { return { html: '', scopeName: '' }; }
}

function groupIssuesByFile(issues) {
  const map = new Map();
  for (const issue of issues) {
    const key = issue.file || '(unknown)';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(issue);
  }
  return map;
}

const SEVERITY_META = {
  red:    { order: 0, icon: '🔴', color: '#ef4444', title: 'Critical Issues', desc: 'Blocking problems that should be fixed before merge.' },
  yellow: { order: 1, icon: '🟡', color: '#eab308', title: 'Warnings', desc: 'Meaningful risks or missing guards that should be addressed.' },
  green:  { order: 2, icon: '🟢', color: '#22c55e', title: 'Improvements', desc: 'Minor but real quality issues that affect maintainability.' },
  blue:   { order: 3, icon: '🔵', color: '#38bdf8', title: 'Suggestions', desc: 'Nice-to-have suggestions that do not affect score.' },
};

function renderLogBlock(title, content) {
  if (!content) return '';
  return `<details class="code-detail"><summary class="code-toggle">▶ ${title}</summary><pre class="code-block">${escHtml(content)}</pre></details>`;
}

function buildTestHTML(test) {
  if (!test || !test.output) return '';

  return `<div class="sec">
  <h2>AI-Generated Tests</h2>
  <div class="test-card">
    <div class="test-row">
      ${test.stack ? `<span class="b bb">${escHtml(test.stack)}</span>` : ''}
      ${test.tokens?.total_tokens ? `<span class="b by">${test.tokens.total_tokens} tokens</span>` : ''}
    </div>
    ${renderLogBlock('Generated test cases & code', test.output)}
  </div>
</div>`;
}

export function generateHTML(review, meta, test) {
  const threshold = meta.threshold || 85;
  const maxMajor = meta.maxMajor ?? 3;
  const sc = review.score >= 95 ? '#22c55e' : review.score >= threshold ? '#eab308' : '#ef4444';
  const issues = review.issues || [];
  const overallPassed =
    !review.parseError &&
    review.score >= threshold &&
    (review.red || 0) === 0 &&
    (review.yellow || 0) <= maxMajor;
  const blockingCount = review.red || 0;
  const nonBlockingCount = (review.yellow || 0) + (review.green || 0);
  const suggestionCount = review.blue || 0;
  const testHTML = buildTestHTML(test);

  let issuesHTML = '';
  if (review.parseError) {
    issuesHTML = '<div style="text-align:center;padding:32px;color:#f59e0b;font-size:16px">⚠️ The AI did not return a structured review JSON, so scoring is unreliable for this run.</div>';
  } else if (issues.length === 0) {
    issuesHTML = '<div style="text-align:center;padding:32px;color:#22c55e;font-size:16px">✅ No issues found</div>';
  } else {
    const severitySections = Object.entries(SEVERITY_META)
      .map(([severity, metaInfo]) => {
        const severityIssues = issues.filter((issue) => issue.severity === severity);
        if (severityIssues.length === 0) return '';
        const fileGroups = groupIssuesByFile(severityIssues);
        const fileBlocks = [];

        for (const [file, fileIssues] of fileGroups) {
          const issueCards = fileIssues.map((i) => {
            let snippetHTML = '';
            let scopeLabel = '';
            if (i.code) {
              const highlighted = i.code.split('\n').map((l) => highlightCode(l)).join('\n');
              snippetHTML = `<details class="code-detail" open><summary class="code-toggle">▶ Problematic code</summary><pre class="code-block">${highlighted}</pre></details>`;
            } else {
              const { html: fallback, scopeName } = getCodeSnippetHTML(i.file, i);
              scopeLabel = scopeName;
              if (fallback) {
                const label = scopeName ? `▶ ${escHtml(scopeName)}` : `▶ Code context (~L${i.line || '?'})`;
                snippetHTML = `<details class="code-detail" open><summary class="code-toggle">${label}</summary><pre class="code-block">${fallback}</pre></details>`;
              }
            }

            const locationBadge = scopeLabel
              ? `<span class="scope-badge">${escHtml(scopeLabel)}</span>`
              : (i.line ? `<span class="line-badge">~L${i.line}</span>` : '');

            return `<div class="issue-card" style="border-left:3px solid ${metaInfo.color}">
  <div class="issue-header">
    <span style="color:${metaInfo.color};font-weight:600">${metaInfo.icon} ${escHtml(i.title)}</span>
    ${locationBadge}
  </div>
  <div class="issue-desc">${escHtml(i.desc)}</div>
  <div class="issue-fix"><strong>Fix:</strong> ${escHtml(i.fix)}</div>
  ${snippetHTML}
</div>`;
          }).join('\n');

          fileBlocks.push(`<div class="file-group">
  <div class="file-header"><code class="file-path">${escHtml(file)}</code> <span class="issue-count">${fileIssues.length} issue${fileIssues.length > 1 ? 's' : ''}</span></div>
  ${issueCards}
</div>`);
        }

        return `<div class="severity-section">
  <div class="severity-heading">
    <div>
      <h3 style="color:${metaInfo.color}">${metaInfo.icon} ${metaInfo.title}</h3>
      <p>${metaInfo.desc}</p>
    </div>
    <span class="severity-count" style="border-color:${metaInfo.color}40;color:${metaInfo.color};background:${metaInfo.color}15">${severityIssues.length}</span>
  </div>
  ${fileBlocks.join('\n')}
</div>`;
      })
      .filter(Boolean);

    issuesHTML = severitySections.join('\n');
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Review Report — ${meta.date}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;padding:24px;max-width:1000px;margin:0 auto}
h1{font-size:20px;color:#22d3ee;margin-bottom:4px}
.meta{color:#64748b;font-size:13px;margin-bottom:24px}
.sc{display:flex;align-items:center;gap:24px;background:#1e293b;border-radius:16px;padding:24px;margin-bottom:24px;border:1px solid #334155}
.ring{width:80px;height:80px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;border:4px solid ${sc};color:${sc};flex-shrink:0}
.detail{flex:1}.detail .sum{font-size:15px;margin-bottom:8px}
.badges{display:flex;gap:8px;flex-wrap:wrap}
.b{padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;display:inline-block}
.br{background:#ef444420;color:#ef4444;border:1px solid #ef444440}
.by{background:#eab30820;color:#eab308;border:1px solid #eab30840}
.bg{background:#22c55e20;color:#22c55e;border:1px solid #22c55e40}
.bb{background:#38bdf820;color:#38bdf8;border:1px solid #38bdf840}
.bp{background:#22c55e20;color:#22c55e;border:1px solid #22c55e40;font-size:14px;padding:6px 14px}
.bf{background:#ef444420;color:#ef4444;border:1px solid #ef444440;font-size:14px;padding:6px 14px}
.summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px}
.summary-card{background:#0f172a;border:1px solid #334155;border-radius:10px;padding:12px 14px}
.summary-card .k{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
.summary-card .v{font-size:22px;font-weight:700;line-height:1}
.summary-card .d{font-size:12px;color:#94a3b8;margin-top:6px}
.test-card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px}
.test-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.test-note{font-size:13px;color:#fbbf24;margin-bottom:10px}
.test-meta-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:12px}
.test-meta-value{font-size:13px;color:#e2e8f0;word-break:break-word}
.sec{margin-top:24px}.sec h2{font-size:15px;color:#94a3b8;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #1e293b}
.severity-section{margin-bottom:24px}
.severity-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:12px}
.severity-heading h3{font-size:16px;margin-bottom:4px}
.severity-heading p{font-size:12px;color:#64748b}
.severity-count{min-width:36px;height:28px;padding:0 10px;border-radius:999px;border:1px solid #334155;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px}
.file-group{margin-bottom:20px;background:#1e293b;border-radius:12px;border:1px solid #334155;overflow:hidden}
.file-header{padding:12px 16px;background:#1e293b;border-bottom:1px solid #334155;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.file-path{background:#0f172a;padding:3px 8px;border-radius:4px;font-size:13px;color:#22d3ee}
.issue-count{color:#64748b;font-size:12px;margin-left:auto}
.issue-card{padding:12px 16px;border-bottom:1px solid #0f172a20;margin:0}
.issue-card:last-child{border-bottom:none}
.issue-header{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.line-badge{background:#334155;color:#94a3b8;padding:1px 6px;border-radius:4px;font-size:11px;font-family:monospace}
.scope-badge{background:#22d3ee18;color:#22d3ee;padding:1px 8px;border-radius:4px;font-size:11px;font-family:monospace;border:1px solid #22d3ee30}
.issue-desc{color:#94a3b8;font-size:13px;margin-bottom:6px}
.issue-fix{font-size:13px;color:#a5b4fc;margin-bottom:6px}
.code-detail{margin-top:6px}
.code-toggle{cursor:pointer;font-size:12px;color:#64748b;padding:4px 0;user-select:none}
.code-toggle:hover{color:#94a3b8}
.code-block{background:#0f172a;border:1px solid #334155;border-radius:6px;padding:10px 14px;font-size:12px;line-height:1.6;overflow-x:auto;color:#cbd5e1;margin-top:6px;white-space:pre;font-family:'Fira Code','JetBrains Mono',Consolas,'Courier New',monospace}
.hl-target{background:#ef444418;display:inline-block;width:100%;border-left:2px solid #ef4444;padding-left:4px;margin-left:-6px}
.hl-ln{color:#475569;user-select:none}
.hl-k{color:#c084fc}
.hl-s{color:#86efac}
.hl-n{color:#fbbf24}
.hl-c{color:#64748b;font-style:italic}
.ft{margin-top:32px;padding-top:16px;border-top:1px solid #1e293b;color:#475569;font-size:12px;text-align:center}
@media (max-width: 700px){.summary-grid,.test-meta-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<h1>🤖 AI Code Review Report</h1>
<div class="meta">${meta.date} · ${meta.model} · ${meta.mode || ''} · ${meta.extra || ''}</div>
<div class="sc">
  <div class="ring">${review.score}</div>
  <div class="detail">
    <div class="sum">${escHtml(review.summary) || '—'}</div>
    <div class="badges">
      <span class="${overallPassed ? 'b bp' : 'b bf'}">${overallPassed ? '✅ PASS' : '❌ BLOCKED'}</span>
      ${review.parseError ? `<span class="b by">⚠️ Review Parse Error</span>` : ''}
      ${review.red ? `<span class="b br">🔴 ${review.red} Critical</span>` : ''}
      ${review.yellow ? `<span class="b by">🟡 ${review.yellow} Warning</span>` : ''}
      ${review.green ? `<span class="b bg">🟢 ${review.green} Improvement</span>` : ''}
      ${review.blue ? `<span class="b bb">🔵 ${review.blue} Suggestion</span>` : ''}
    </div>
    <div class="summary-grid">
      <div class="summary-card">
        <div class="k">Blocking Issues</div>
        <div class="v" style="color:${blockingCount ? '#ef4444' : '#22c55e'}">${blockingCount}</div>
        <div class="d">${blockingCount ? 'Critical problems that can block merge.' : 'No blocking issues detected.'}</div>
      </div>
      <div class="summary-card">
        <div class="k">Non-blocking Issues</div>
        <div class="v" style="color:${nonBlockingCount ? '#eab308' : '#22c55e'}">${nonBlockingCount}</div>
        <div class="d">Warnings and improvements worth tracking.</div>
      </div>
      <div class="summary-card">
        <div class="k">Suggestions</div>
        <div class="v" style="color:${suggestionCount ? '#38bdf8' : '#94a3b8'}">${suggestionCount}</div>
        <div class="d">Nice-to-have ideas that do not affect score.</div>
      </div>
    </div>
  </div>
</div>
${testHTML}
<div class="sec">
  <h2>Issues (${issues.length}) — grouped by severity</h2>
  ${issuesHTML}
</div>
<div class="ft">Generated by ai-review-pipeline · Model: ${meta.model} · ⚠️ AI Review does not replace human Code Review</div>
</body></html>`;
}

export function writeReport({ review, meta, test, outputDir, open }) {
  const outDir = resolve(process.cwd(), outputDir);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const prefix = meta.mode === 'fix' ? 'fix' : 'review';
  const reportPath = resolve(outDir, `${prefix}-${ts}.html`);
  writeFileSync(reportPath, generateHTML(review, meta, test), 'utf-8');

  if (open) {
    try {
      const cmd = process.platform === 'win32' ? `start "" "${reportPath}"` : `${process.platform === 'darwin' ? 'open' : 'xdg-open'} "${reportPath}"`;
      execSync(cmd, { stdio: 'ignore' });
    } catch { /* can't auto-open */ }
  }
  return reportPath;
}
