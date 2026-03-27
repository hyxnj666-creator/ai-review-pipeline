import { execSync } from 'node:child_process';

const MAX_BUFFER = 5 * 1024 * 1024;
const CODE_EXT = /\.(ts|tsx|vue|js|jsx|py|mjs|cjs|go|rs|java|kt|swift|rb|php|cs)$/;

function exec(cmd) {
  return execSync(cmd, { encoding: 'utf-8', maxBuffer: MAX_BUFFER });
}

export function getDiff({ file, branch, staged } = {}) {
  if (file) {
    const paths = file.split(',').map((s) => s.trim()).filter(Boolean);
    return exec(`git diff HEAD -- ${paths.join(' ')}`);
  }
  if (branch) return exec(`git diff ${branch}...HEAD`);
  if (staged) return exec('git diff --cached');
  const s = exec('git diff --cached');
  return s || exec('git diff HEAD');
}

export function getChangedFiles({ file, staged } = {}) {
  if (file) {
    const paths = file.split(',').map((s) => s.trim()).filter(Boolean);
    return exec(`git diff HEAD --name-only --diff-filter=ACMR -- ${paths.join(' ')}`)
      .trim().split('\n').filter(Boolean).filter((f) => CODE_EXT.test(f));
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
