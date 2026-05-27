// Vercel Edge Function — proxies Shopee CDN images so the browser download
// attribute works (same-origin) instead of opening a new tab.
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url') || '';
  const n   = searchParams.get('n')   || '1';

  // Only allow Shopee CDN URLs
  if (!url.match(/^https?:\/\/(cf\.shopee\.sg|down-[a-z]+\.img\.susercontent\.com)\//)) {
    return new Response('Invalid URL', { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: { 'Referer': 'https://shopee.sg/' },
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
