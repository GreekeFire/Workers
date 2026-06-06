// Reads Carousell offers/chats using session cookie stored in CAROUSELL_COOKIES env var.
export const config = { runtime: 'edge', regions: ['sin1'] };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const cookieStr = process.env.CAROUSELL_COOKIES || '';
  const hasCookies = cookieStr.length > 0;
  if (!hasCookies) return json({ error: 'CAROUSELL_COOKIES not set', hasCookies: false }, 500);

  const { searchParams } = new URL(req.url);
  const type  = searchParams.get('type')  || 'received'; // received | made
  const count = searchParams.get('count') || '50';

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-SG,en;q=0.9',
    'Referer': 'https://www.carousell.sg/',
    'Cookie': cookieStr,
  };

  const url = `https://www.carousell.sg/ds/offer/1.0/me/?count=${count}&type=${type}`;

  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out')), 12000));
    const resp = await Promise.race([fetch(url, { headers }), timeout]);
    const raw = await resp.json();

    const offers = raw?.data?.offers || raw?.offers || [];
    if (!offers.length && raw?.error) {
      return json({ error: `API error: ${raw.error}`, hasCookies, raw }, 502);
    }

    const chats = offers.map(o => ({
      id:          o?.id || o?.offerId || null,
      itemTitle:   o?.listing?.title || o?.listingSnapshot?.title || '',
      itemId:      o?.listing?.id || o?.listingId || null,
      buyerName:   o?.buyer?.username || o?.offerer?.username || '',
      sellerName:  o?.seller?.username || '',
      price:       o?.price?.value || o?.offerPrice || null,
      listPrice:   o?.listing?.price?.value || null,
      lastMessage: o?.lastMessage?.content || '',
      lastAt:      o?.lastMessage?.createdAt || o?.updatedAt || null,
      state:       o?.state || null,
    }));

    return json({ type, count: chats.length, hasCookies, chats, raw });

  } catch (e) {
    return json({ error: e.message || 'Request failed', hasCookies }, 502);
  }
}
