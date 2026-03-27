import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { readdirSync } from 'node:fs';

const MAX_BUFFER = 5 * 1024 * 1024;
const CODE_EXT = /\.(ts|tsx|vue|js|jsx|py|mjs|cjs|go|rs|java|kt|swift|rb|php|cs|uvue)$/;

function exec(cmd) {
  return execSync(cmd, { encoding: 'utf-8', maxBuffer: MAX_BUFFER });
}

function readFileAsReview(filePath) {
  const full = resolve(process.cwd(), filePath);
  if (!existsSync(full)) return '';
  const stat = statSync(full);
  if (stat.isDirectory()) {
    return collectDirFiles(full).map((f) => {
      const rel = relative(process.cwd(), f);
      const content = readFileSync(f, 'utf-8');
      return `--- a/${rel}\n+++ b/${rel}\n${content.split('\n').map((l) => `+${l}`).join('\n')}`;
    }).join('\n');
  }
  const content = readFileSync(full, 'utf-8');
  return `--- a/${filePath}\n+++ b/${filePath}\n${content.split('\n').map((l) => `+${l}`).join('\n')}`;
}

function collectDirFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.git', 'dist', '.next'].includes(entry.name)) {
        results.push(...collectDirFiles(full));
      }
    } else if (CODE_EXT.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

export function getDiff({ file, branch, staged, full } = {}) {
  if (file) {
    const paths = file.split(',').map((s) => s.trim()).filter(Boolean);
    if (full) {
      return paths.map((p) => readFileAsReview(p)).filter(Boolean).join('\n');
    }
    try {
      const diff = exec(`git diff HEAD -- ${paths.join(' ')}`);
      if (diff.trim()) return diff;
    } catch { /* not in git repo or no diff, fall through */ }
    return paths.map((p) => readFileAsReview(p)).filter(Boolean).join('\n');
  }
  if (branch) return exec(`git diff ${branch}...HEAD`);
  if (staged) return exec('git diff --cached');
  const s = exec('git diff --cached');
  return s || exec('git diff HEAD');
}

function resolveFilePaths(paths) {
  const result = [];
  for (const p of paths) {
    const fullPath = resolve(process.cwd(), p);
    if (!existsSync(fullPath)) continue;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      result.push(...collectDirFiles(fullPath).map((f) => relative(process.cwd(), f)));
    } else if (CODE_EXT.test(p)) {
      result.push(p);
    }
  }
  return result;
}

export function getChangedFiles({ file, staged, full } = {}) {
  if (file) {
    const paths = file.split(',').map((s) => s.trim()).filter(Boolean);
    if (full) return resolveFilePaths(paths);
    try {
      const diffFiles = exec(`git diff HEAD --name-only --diff-filter=ACMR -- ${paths.join(' ')}`)
        .trim().split('\n').filter(Boolean).filter((f) => CODE_EXT.test(f));
      if (diffFiles.length) return diffFiles;
    } catch { /* fall through */ }
    return resolveFilePaths(paths);
  }
  if (staged) {
    return exec('git diff --cached --name-only --diff-filter=ACMR')
      .trim().split('\n').filter(Boolean).filter((f) => CODE_EXT.test(f));
  }
  try {
    const files = exec('git diff --cached --name-only --diff-filter=ACMR')
      .trim().split('\n').filter(Boolean).filter((f) => CODE_EXT.test(f));
    if (files.length) return files;
  } catch { /* fall through */ }
  return exec('git diff HEAD --name-only --diff-filter=ACMR')
    .trim().split('\n').filter(Boolean).filter((f) => CODE_EXT.test(f));
}
