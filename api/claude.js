// Vercel Edge Function — proxies Claude API requests so the Anthropic key
// never touches the browser. Set ANTHROPIC_API_KEY in Vercel environment vars.
export const config = { runtime: 'edge', regions: ['sin1'] };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'API key not configured on server' }, 500);

  let body;
  try { body = await req.json(); }
  catch (e) { return json({ error: 'Invalid JSON body' }, 400); }

  const { system, userContent, maxTokens = 1536, temperature = 0.3, model = 'claude-haiku-4-5-20251001' } = body;
  if (!system || !userContent) return json({ error: 'system and userContent are required' }, 400);

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    const data = await resp.json();
    if (data.error) return json({ error: data.error.message }, resp.status);
    return json({ text: data.content?.[0]?.text || '' });
  } catch (e) {
    return json({ error: e.message || 'Upstream request failed' }, 502);
  }
}
