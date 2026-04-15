const _BK = 'QUl6YVN5Q3JBZ1dsNXd1eTEzY3h3QnVZanFwdzNyalQzOWJzc3NV';
export const BUILTIN_KEY = atob(_BK);
export const BUILTIN_PROVIDER = 'gemini';

let fetchImpl = globalThis.fetch;
let proxyInited = false;

export async function initProxy(proxyUrl) {
  if (proxyInited || !proxyUrl) return;
  proxyInited = true;
  try {
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    const agent = new HttpsProxyAgent(proxyUrl);
    const orig = globalThis.fetch;
    fetchImpl = (u, o) => orig(u, { ...o, agent });
  } catch { /* https-proxy-agent not installed, skip */ }
}

const PROVIDERS = {
  openai:   { baseUrl: 'https://api.openai.com/v1',        defaultModel: 'gpt-4o-mini' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1',      defaultModel: 'deepseek-chat' },
  ollama:   { baseUrl: 'http://localhost:11434/v1',         defaultModel: 'qwen2.5-coder' },
  claude:   { baseUrl: 'https://api.anthropic.com',         defaultModel: 'claude-sonnet-4-20250514' },
  qwen:     { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus' },
  gemini:   { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.0-flash' },
};

export function resolveProvider(env) {
  if (env.provider && PROVIDERS[env.provider]) return env.provider;
  if (env.provider === 'custom') return 'custom';

  if (env.apiKey?.startsWith('sk-ant-')) return 'claude';

  if (env.baseUrl) {
    if (env.baseUrl.includes('deepseek')) return 'deepseek';
    if (env.baseUrl.includes('anthropic')) return 'claude';
    if (env.baseUrl.includes('localhost:11434') || env.baseUrl.includes('ollama')) return 'ollama';
    if (env.baseUrl.includes('dashscope')) return 'qwen';
    if (env.baseUrl.includes('generativelanguage.googleapis')) return 'gemini';
  }

  return 'openai';
}

export function getProviderDefaults(provider) {
  return PROVIDERS[provider] || PROVIDERS.openai;
}

async function callOpenAICompatible({ baseUrl, apiKey, model, systemPrompt, prompt, temperature, maxTokens }) {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
  });
  if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    tokens: data.usage,
  };
}

async function callClaude({ baseUrl, apiKey, model, systemPrompt, prompt, temperature, maxTokens }) {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
    temperature,
  };
  if (systemPrompt) body.system = systemPrompt;

  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2024-10-22',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data.content?.map((b) => b.text).join('') ?? '';
  return {
    content: text,
    tokens: data.usage ? {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
    } : null,
  };
}

async function withRetry(fn, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      const status = e.message?.match(/API (\d+)/)?.[1];
      const retryable = !status || status === '429' || status === '500' || status === '502' || status === '503';
      if (i >= retries || !retryable) throw e;
      const delay = Math.min(1000 * 2 ** i, 8000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export async function callAI({ baseUrl, apiKey, model, systemPrompt, prompt, temperature = 0.3, maxTokens = 4096, provider = 'openai' }) {
  return withRetry(() => {
    if (provider === 'claude') {
      return callClaude({ baseUrl, apiKey, model, systemPrompt, prompt, temperature, maxTokens });
    }
    return callOpenAICompatible({ baseUrl, apiKey, model, systemPrompt, prompt, temperature, maxTokens });
  });
}
