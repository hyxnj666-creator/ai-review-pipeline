import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveProvider, getProviderDefaults } from './ai-client.mjs';

const DEFAULTS = {
  review: {
    threshold: 95,
    maxRounds: 5,
    model: '',
    maxDiffLines: 1500,
    customRules: [],
    skip: [],
  },
  fix: {
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
  const apiKey = process.env.AI_REVIEW_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.DEEPSEEK_API_KEY
    || process.env.ANTHROPIC_API_KEY
    || process.env.DASHSCOPE_API_KEY
    || process.env.GEMINI_API_KEY
    || '';

  const baseUrl = process.env.AI_REVIEW_BASE_URL || '';
  const providerHint = process.env.AI_REVIEW_PROVIDER || '';
  const model = process.env.AI_REVIEW_MODEL || '';
  const proxy = process.env.HTTPS_PROXY || '';

  const env = { apiKey, baseUrl, provider: providerHint, model, proxy };
  const provider = resolveProvider(env);
  const defaults = getProviderDefaults(provider);

  return {
    apiKey,
    baseUrl: baseUrl || defaults.baseUrl,
    model: model || defaults.defaultModel,
    provider,
    proxy,
  };
}
