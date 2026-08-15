import { getDeepSeekKey, getVolcanoKey } from './_config.js';

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const { prompt, system } = body;
    if (!prompt) return new Response(JSON.stringify({ error: '需要prompt' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    const deepseekKey = getDeepSeekKey(context.env);
    if (deepseekKey) {
      const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + deepseekKey },
        body: JSON.stringify({ model: 'deepseek-chat', messages, temperature: 0.7, max_tokens: 2000 }),
        signal: AbortSignal.timeout(25000)
      });
      if (resp.ok) {
        const data = await resp.json();
        return new Response(JSON.stringify({ source: 'deepseek', content: data.choices?.[0]?.message?.content || '' }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }
    // 火山方舟备用
    const volcanoKey = getVolcanoKey(context.env);
    if (volcanoKey) {
      try {
        const resp = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + volcanoKey },
          body: JSON.stringify({ model: 'doubao-pro-32k', messages, temperature: 0.7, max_tokens: 2000 }),
          signal: AbortSignal.timeout(25000)
        });
        if (resp.ok) {
          const data = await resp.json();
          return new Response(JSON.stringify({ source: 'volcano', content: data.choices?.[0]?.message?.content || '' }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
      } catch (e) {}
    }
    return new Response(JSON.stringify({ source: 'fallback', content: '', error: 'AI服务暂时不可用' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
export async function onRequestOptions() {
  return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
