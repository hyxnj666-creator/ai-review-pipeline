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

export async function callAI({ baseUrl, apiKey, model, prompt, temperature = 0.3, maxTokens = 4096 }) {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens,
    }),
  });
  if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    tokens: data.usage,
  };
}
