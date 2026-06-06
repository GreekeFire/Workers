// Carousell search via mobile app API endpoints — bypass Cloudflare WAF on web.
export const config = { runtime: 'edge', regions: ['sin1'] };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

// Mobile app User-Agent — hits different CDN path than browser requests
const MOBILE_HEADERS = {
  'User-Agent': 'Carousell/3.0 (Android; com.carousell.carousell; build/2024)',
  'Accept': 'application/json',
  'Accept-Language': 'en-SG',
  'X-Carousell-Platform': 'android',
};

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-SG,en;q=0.9',
  'Referer': 'https://www.carousell.sg/',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q');
  if (!query) return json({ error: 'q parameter required' }, 400);

  const timeout = (ms) => new Promise((_, r) => setTimeout(() => r(new Error('Timed out')), ms));

  const attempts = [
    // Mobile app API
    { url: `https://api.carousell.com/api-service/search/cf/4.0/search/?query=${encodeURIComponent(query)}&count=30&sortParam.fieldName=3`, headers: MOBILE_HEADERS },
    { url: `https://api.carousell.sg/api-service/search/cf/4.0/search/?query=${encodeURIComponent(query)}&count=30`, headers: MOBILE_HEADERS },
    // Web API with browser headers
    { url: `https://www.carousell.sg/api-service/search/cf/4.0/search/?query=${encodeURIComponent(query)}&count=30&sortParam.fieldName=3`, headers: BROWSER_HEADERS },
  ];

  const results = [];

  for (const attempt of attempts) {
    try {
      const resp = await Promise.race([fetch(attempt.url, { headers: attempt.headers }), timeout(8000)]);
      const text = await resp.text();
      const ct   = resp.headers.get('content-type') || '';

      results.push({ url: attempt.url, status: resp.status, ct, snippet: text.slice(0, 300) });

      if (!ct.includes('json')) continue;

      const raw   = JSON.parse(text);
      const items = raw?.data?.results || raw?.results || raw?.listings || [];
      if (!items.length) continue;

      const listings = items.map(item => {
        const l = item?.listingCard || item?.listing || item;
        return {
          id:     l?.id || null,
          title:  l?.title || l?.name || '',
          price:  l?.price?.value || l?.price?.amount || l?.price || null,
          sold:   l?.sold || l?.isSold || false,
          url:    l?.id ? `https://www.carousell.sg/p/${l.id}/` : null,
          image:  l?.coverPhoto?.thumbnailUrl || l?.photos?.[0]?.thumbnailUrl || null,
          seller: l?.seller?.username || null,
        };
      });

      return json({ query, count: listings.length, listings });
    } catch (e) {
      results.push({ url: attempt.url, error: e.message });
    }
  }

  // All failed — return debug info showing what each endpoint returned
  return json({ error: 'All endpoints blocked', attempts: results }, 502);
}
