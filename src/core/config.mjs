import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveProvider, getProviderDefaults, BUILTIN_KEY, BUILTIN_PROVIDER } from './ai-client.mjs';

function stripJsonComments(raw) {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < raw.length) {
    if (inStr) {
      if (raw[i] === '\\') { out += raw[i] + (raw[i + 1] || ''); i += 2; continue; }
      if (raw[i] === '"') inStr = false;
      out += raw[i++];
    } else {
      if (raw[i] === '"') { inStr = true; out += raw[i++]; continue; }
      if (raw[i] === '/' && raw[i + 1] === '/') { while (i < raw.length && raw[i] !== '\n') i++; continue; }
      if (raw[i] === '/' && raw[i + 1] === '*') { i += 2; while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++; i += 2; continue; }
      out += raw[i++];
    }
  }
  return out;
}

const DEFAULTS = {
  review: {
    threshold: 95,
    maxRounds: 5,
    model: '',
    temperature: 0.1,
    maxTokens: 8192,
    maxDiffLines: 1500,
    enableRules: true,
    customRules: [],
    skip: [],
  },
  fix: {
    safetyMinRatio: 0.5,
    temperature: 0.2,
    maxTokens: 8192,
  },
  test: {
    enabled: true,
    run: true,
    stack: 'auto',
    maxCases: 8,
    temperature: 0.4,
    maxTokens: 12288,
    tempDir: '.ai-tests',
    keepFailed: true,
    command: '',
    timeoutMs: 120000,
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
      const raw = readFileSync(p, 'utf-8');
      const u = JSON.parse(stripJsonComments(raw));
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
    ['SILICONFLOW_API_KEY', 'siliconflow'],
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
  let providerHint = process.env.AI_REVIEW_PROVIDER || inferredProvider;
  const requestedModel = process.env.AI_REVIEW_MODEL || '';
  const proxy = process.env.HTTPS_PROXY || '';

  let builtinFallback = false;
  let ignoredModelOverride = false;
  if (!apiKey && !providerHint) {
    apiKey = BUILTIN_KEY;
    providerHint = BUILTIN_PROVIDER;
    builtinFallback = true;
    ignoredModelOverride = Boolean(requestedModel);
  }

  const model = ignoredModelOverride ? '' : requestedModel;
  const env = { apiKey, baseUrl, provider: providerHint, model, proxy };
  const provider = resolveProvider(env);
  const defaults = getProviderDefaults(provider);

  return {
    apiKey,
    baseUrl: baseUrl || defaults.baseUrl,
    model: model || defaults.defaultModel,
    provider,
    proxy,
    builtinFallback,
    ignoredModelOverride,
    requestedModel,
  };
}
