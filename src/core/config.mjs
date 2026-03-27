import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULTS = {
  review: {
    threshold: 95,
    maxRounds: 3,
    model: '',
    maxDiffLines: 1500,
    customRules: [],
    skip: [],
  },
  fix: {
    enabled: false,
    requireConfirm: true,
    safetyMinRatio: 0.5,
  },
  test: {
    enabled: true,
    stack: 'auto',
    maxCases: 8,
  },
  report: {
    format: 'html',
    outputDir: '.ai-reports',
    open: true,
  },
  ignore: [],
};

export function loadConfig(cwd = process.cwd()) {
  for (const name of ['.ai-pipeline.json', 'scripts/.ai-pipeline.json']) {
    const p = resolve(cwd, name);
    if (!existsSync(p)) continue;
    try {
      const u = JSON.parse(readFileSync(p, 'utf-8'));
      return {
        review: { ...DEFAULTS.review, ...u.review },
        fix: { ...DEFAULTS.fix, ...u.fix },
        test: { ...DEFAULTS.test, ...u.test },
        report: { ...DEFAULTS.report, ...u.report },
        ignore: u.ignore || DEFAULTS.ignore,
      };
    } catch { /* invalid json, use defaults */ }
  }
  return structuredClone(DEFAULTS);
}

export function getEnvConfig() {
  return {
    apiKey: process.env.AI_REVIEW_API_KEY || process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.AI_REVIEW_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.AI_REVIEW_MODEL || '',
    proxy: process.env.HTTPS_PROXY || '',
  };
}
