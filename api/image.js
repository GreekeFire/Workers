// Vercel Edge Function — proxies Shopee CDN images so the browser download
// attribute works (same-origin) instead of opening a new tab.
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url') || '';
  const n   = searchParams.get('n')   || '1';

  // Allow any subdomain of known Shopee CDN domains
  const isShopee = /^https?:\/\/[a-zA-Z0-9.-]+(shopee\.sg|susercontent\.com|shopeemobile\.com)\//.test(url);
  // Covers that were cleaned or restaged live in our own Supabase bucket, not on
  // Shopee — without this every such listing 400s on "Download all". Pinned to the
  // public covers path on our project so this stays a proxy for our own files and
  // not an open one.
  const isOwnStorage = /^https:\/\/tzwzmzabjmsocnxdtxqx\.supabase\.co\/storage\/v1\/(object|render\/image)\/public\/covers\//.test(url);
  if (!isShopee && !isOwnStorage) {
    return new Response('Invalid URL', { status: 400 });
  }

  try {
    const response = await fetch(url, {
      // The referer is what gets past Shopee's hotlink protection; our own bucket
      // neither needs nor wants it.
      headers: isShopee ? { 'Referer': 'https://shopee.sg/' } : {},
    });
    if (!response.ok) return new Response('Image fetch failed', { status: 502 });

    const blob        = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const ext         = contentType.includes('png') ? 'png' : 'jpg';

    return new Response(blob, {
      headers: {
        'Content-Type':        contentType,
        'Content-Disposition': `attachment; filename="shopee-${n}.${ext}"`,
        'Cache-Control':       'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch(e) {
    return new Response('Error: ' + e.message, { status: 502 });
  }
}
