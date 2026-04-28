import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const _BK = 'c2stZGhxdGN2dXl4ZHR1bm5lZ3RmbGdranlob2hhY2tiamt3dmxtbmR1aHlyb2FuZHZs';
export const BUILTIN_KEY = atob(_BK);
export const BUILTIN_PROVIDER = 'siliconflow';

let fetchImpl = globalThis.fetch;
let proxyInited = false;
const requireFromHere = createRequire(import.meta.url);

async function loadHttpsProxyAgent() {
  const candidates = [];
  try {
    candidates.push(requireFromHere.resolve('https-proxy-agent', { paths: [process.cwd()] }));
  } catch { /* ignore */ }
  try {
    candidates.push(requireFromHere.resolve('https-proxy-agent'));
  } catch { /* ignore */ }

  for (const resolved of [...new Set(candidates)]) {
    try {
      const mod = await import(pathToFileURL(resolved).href);
      if (mod?.HttpsProxyAgent) return mod.HttpsProxyAgent;
      if (mod?.default?.HttpsProxyAgent) return mod.default.HttpsProxyAgent;
      if (typeof mod?.default === 'function') return mod.default;
    } catch { /* try next candidate */ }
  }

  return null;
}

export async function initProxy(proxyUrl) {
  if (proxyInited || !proxyUrl) return;
  proxyInited = true;
  try {
    const HttpsProxyAgent = await loadHttpsProxyAgent();
    if (!HttpsProxyAgent) return;
    const agent = new HttpsProxyAgent(proxyUrl);
    const orig = globalThis.fetch;
    fetchImpl = (u, o) => orig(u, { ...o, agent });
  } catch { /* https-proxy-agent not installed, skip */ }
}

const PROVIDERS = {
  openai:      { baseUrl: 'https://api.openai.com/v1',        defaultModel: 'gpt-4o-mini' },
  deepseek:    { baseUrl: 'https://api.deepseek.com/v1',      defaultModel: 'deepseek-chat' },
  ollama:      { baseUrl: 'http://localhost:11434/v1',         defaultModel: 'qwen2.5-coder' },
  claude:      { baseUrl: 'https://api.anthropic.com',         defaultModel: 'claude-sonnet-4-20250514' },
  qwen:        { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus' },
  gemini:      { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.0-flash' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1',    defaultModel: 'deepseek-ai/DeepSeek-V4-Flash' },
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
    if (env.baseUrl.includes('siliconflow')) return 'siliconflow';
  }

  return 'openai';
}

export function getProviderDefaults(provider) {
  return PROVIDERS[provider] || PROVIDERS.openai;
}

function shouldUseOpenAIMaxCompletionTokens(baseUrl, model) {
  const normalizedBaseUrl = String(baseUrl || '').toLowerCase();
  const normalizedModel = String(model || '').toLowerCase();
  return normalizedBaseUrl.includes('api.openai.com') && /^gpt-5([.-]|$)/.test(normalizedModel);
}

function buildOpenAICompatibleBody({ model, messages, temperature, maxTokens, shouldStream, responseFormat, useMaxCompletionTokens = false }) {
  const body = { model, messages, temperature };
  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens)) {
    body[useMaxCompletionTokens ? 'max_completion_tokens' : 'max_tokens'] = maxTokens;
  }
  if (shouldStream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  if (responseFormat && !shouldStream) body.response_format = responseFormat;
  return body;
}

function shouldRetryWithMaxCompletionTokens(errorText) {
  return /unsupported parameter/i.test(errorText)
    && /max_tokens/i.test(errorText)
    && /max_completion_tokens/i.test(errorText);
}

async function callOpenAICompatible({ baseUrl, apiKey, model, systemPrompt, prompt, temperature, maxTokens, stream, onToken, responseFormat, signal }) {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const shouldStream = stream && onToken;
  const sendRequest = (body) => fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  let body = buildOpenAICompatibleBody({
    model,
    messages,
    temperature,
    maxTokens,
    shouldStream,
    responseFormat,
    useMaxCompletionTokens: shouldUseOpenAIMaxCompletionTokens(baseUrl, model),
  });
  let resp = await sendRequest(body);
  if (!resp.ok) {
    const errorText = await resp.text();
    if (body.max_tokens != null && shouldRetryWithMaxCompletionTokens(errorText)) {
      body = buildOpenAICompatibleBody({
        model,
        messages,
        temperature,
        maxTokens,
        shouldStream,
        responseFormat,
        useMaxCompletionTokens: true,
      });
      resp = await sendRequest(body);
    } else {
      throw new Error(`API ${resp.status}: ${errorText}`);
    }
  }
  if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);

  if (shouldStream) {
    let full = '';
    let streamUsage = null;
    const reader = resp.body?.getReader?.();
    if (!reader) {
      const data = await resp.json();
      return { content: data.choices?.[0]?.message?.content ?? '', tokens: data.usage };
    }
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue;
        try {
          const chunk = JSON.parse(trimmed.slice(6));
          const delta = chunk.choices?.[0]?.delta?.content || '';
          if (delta) { full += delta; onToken(delta); }
          if (chunk.usage) streamUsage = chunk.usage;
        } catch { /* skip malformed chunk */ }
      }
    }
    return { content: full, tokens: streamUsage };
  }

  const data = await resp.json();
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    tokens: data.usage,
  };
}

async function callClaude({ baseUrl, apiKey, model, systemPrompt, prompt, temperature, maxTokens, stream, onToken }) {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;
  const shouldStream = stream && onToken;
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
    temperature,
    ...(shouldStream ? { stream: true } : {}),
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

  if (shouldStream) {
    let full = '';
    let streamUsage = null;
    const reader = resp.body?.getReader?.();
    if (!reader) {
      const data = await resp.json();
      const text = data.content?.map((b) => b.text).join('') ?? '';
      return { content: text, tokens: null };
    }
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(trimmed.slice(6));
          if (evt.type === 'message_start' && evt.message?.usage) {
            streamUsage = streamUsage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
            streamUsage.prompt_tokens = evt.message.usage.input_tokens || 0;
          }
          if (evt.type === 'content_block_delta') {
            const delta = evt.delta?.text || '';
            if (delta) { full += delta; onToken(delta); }
          }
          if (evt.type === 'message_delta' && evt.usage) {
            streamUsage = streamUsage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
            streamUsage.completion_tokens = evt.usage.output_tokens || 0;
            streamUsage.total_tokens = (streamUsage.prompt_tokens || 0) + (evt.usage.output_tokens || 0);
          }
        } catch { /* skip */ }
      }
    }
    return { content: full, tokens: streamUsage };
  }

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

const FETCH_TIMEOUT_MS = 90_000;
const RETRYABLE_STATUS = new Set(['429', '500', '502', '503', '504']);

function jitter(base) {
  return Math.round(base * (0.7 + Math.random() * 0.6));
}

const RETRY_DELAYS = [3_000, 8_000, 20_000];

async function withRetry(fn, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`)), FETCH_TIMEOUT_MS);
    try {
      return await fn(controller.signal);
    } catch (e) {
      const isTimeout = e.message?.includes('timed out') || e.name === 'AbortError' || (e.cause && e.cause.message?.includes('timed out'));
      const status = e.message?.match(/API (\d+)/)?.[1];
      const retryable = isTimeout || !status || RETRYABLE_STATUS.has(status);
      if (i >= retries || !retryable) throw e;
      const base = RETRY_DELAYS[Math.min(i, RETRY_DELAYS.length - 1)];
      const wait = jitter(base);
      process.stderr.write(`[ai-rp] attempt ${i + 1} failed (${isTimeout ? 'timeout' : status || e.message?.slice(0, 40)}), retrying in ${Math.round(wait / 1000)}s…\n`);
      await new Promise((r) => setTimeout(r, wait));
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function callAI({ baseUrl, apiKey, model, systemPrompt, prompt, temperature = 0.3, maxTokens = 8192, provider = 'openai', stream = false, onToken, responseFormat }) {
  return withRetry((signal) => {
    if (provider === 'claude') {
      return callClaude({ baseUrl, apiKey, model, systemPrompt, prompt, temperature, maxTokens, stream, onToken });
    }
    return callOpenAICompatible({ baseUrl, apiKey, model, systemPrompt, prompt, temperature, maxTokens, stream, onToken, responseFormat, signal });
  });
}
