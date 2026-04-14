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
  const KEY_PROVIDER_MAP = [
    ['AI_REVIEW_API_KEY', ''],
    ['DEEPSEEK_API_KEY', 'deepseek'],
    ['ANTHROPIC_API_KEY', 'claude'],
    ['DASHSCOPE_API_KEY', 'qwen'],
    ['GEMINI_API_KEY', 'gemini'],
    ['OPENAI_API_KEY', 'openai'],
  ];

  let apiKey = '';
  let inferredProvider = '';
  for (const [envVar, prov] of KEY_PROVIDER_MAP) {
    if (process.env[envVar]) {
      apiKey = process.env[envVar];
      inferredProvider = prov;
      break;
    }
  }

  const baseUrl = process.env.AI_REVIEW_BASE_URL || '';
  const providerHint = process.env.AI_REVIEW_PROVIDER || inferredProvider;
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
