// 仕入れ判定ノート用の中継サーバー（Cloudflare Workers）
// - APIキーは Worker の環境変数（Secrets）に保存し、ブラウザやバックアップには入れない
// - 利用者の操作ごとに呼ばれる。結果は1日キャッシュして API の呼び出し回数を抑える
//
// 必要な環境変数（Cloudflare のダッシュボード → Worker → 設定 → 変数とシークレット）
//   YAHOO_APP_ID      : Yahoo!デベロッパーネットワークの Client ID
//   EBAY_CLIENT_ID    : eBay Developers Program の App ID（Production）
//   EBAY_CLIENT_SECRET: eBay の Cert ID（Production）
//   ALLOWED_ORIGIN    : https://uenokun516-ai.github.io
//   APP_KEY           : 任意の合言葉（アプリの設定にも同じものを入れる）

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '';
    const cors = {
      'access-control-allow-origin': allowed,
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'x-app-key',
      'access-control-max-age': '86400',
      vary: 'origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const reply = (obj, status = 200, extra = {}) =>
      new Response(JSON.stringify(obj), { status, headers: { ...JSON_HEADERS, ...cors, ...extra } });

    if (request.method !== 'GET') return reply({ error: 'method_not_allowed' }, 405);
    if (allowed && origin !== allowed) return reply({ error: 'origin_not_allowed' }, 403);
    if (env.APP_KEY && request.headers.get('x-app-key') !== env.APP_KEY) return reply({ error: 'bad_app_key' }, 401);

    const url = new URL(request.url);
    const jan = (url.searchParams.get('jan') || '').replace(/\D/g, '');
    const q = (url.searchParams.get('q') || '').slice(0, 120);
    const market = /^EBAY_[A-Z]{2,3}$/.test(url.searchParams.get('market') || '') ? url.searchParams.get('market') : 'EBAY_US';

    try {
      if (url.pathname === '/health') {
        return reply({ ok: true, yahoo: !!env.YAHOO_APP_ID, ebay: !!(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET) });
      }
      if (url.pathname === '/yahoo') {
        if (!env.YAHOO_APP_ID) return reply({ error: 'yahoo_not_configured' }, 501);
        if (!jan && !q) return reply({ error: 'jan_or_q_required' }, 400);
        return await cached(ctx, request, () => yahoo(env, jan, q).then((r) => reply(r, 200, { 'cache-control': 'max-age=86400' })));
      }
      if (url.pathname === '/ebay') {
        if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) return reply({ error: 'ebay_not_configured' }, 501);
        if (!jan && !q) return reply({ error: 'jan_or_q_required' }, 400);
        return await cached(ctx, request, () => ebay(env, jan, q, market).then((r) => reply(r, 200, { 'cache-control': 'max-age=86400' })));
      }
      return reply({ error: 'not_found' }, 404);
    } catch (e) {
      return reply({ error: 'upstream_error', detail: String(e && e.message || e).slice(0, 200) }, 502);
    }
  },
};

async function cached(ctx, request, make) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).toString(), { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await make();
  if (res.ok) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// Yahoo!ショッピング 商品検索（v3）：JANコードまたはキーワード
async function yahoo(env, jan, q) {
  const u = new URL('https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch');
  u.searchParams.set('appid', env.YAHOO_APP_ID);
  if (jan) u.searchParams.set('jan_code', jan);
  else u.searchParams.set('query', q);
  u.searchParams.set('results', '20');
  const r = await fetch(u);
  if (!r.ok) throw new Error('yahoo ' + r.status);
  const j = await r.json();
  return {
    source: 'Yahoo!ショッピング',
    fetchedAt: new Date().toISOString(),
    total: j.totalResultsAvailable ?? null,
    items: (j.hits || []).map((h) => ({
      name: h.name,
      price: h.price,
      condition: h.condition, // new / used
      url: h.url,
      image: h.image?.medium || h.image?.small || null,
      janCode: h.janCode || null,
      brand: h.brand?.name || null,
      seller: h.seller?.name || null,
    })),
  };
}

let tokenCache = { token: '', exp: 0 };
async function ebayToken(env) {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60000) return tokenCache.token;
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + btoa(env.EBAY_CLIENT_ID + ':' + env.EBAY_CLIENT_SECRET),
    },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
  });
  if (!r.ok) throw new Error('ebay token ' + r.status);
  const j = await r.json();
  tokenCache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return tokenCache.token;
}

// eBay Browse API：出品中（成約ではない）の検索
async function ebay(env, jan, q, market) {
  const token = await ebayToken(env);
  const u = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
  if (jan) u.searchParams.set('gtin', jan);
  else u.searchParams.set('q', q);
  u.searchParams.set('limit', '50');
  u.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE|AUCTION}');
  const r = await fetch(u, { headers: { authorization: 'Bearer ' + token, 'x-ebay-c-marketplace-id': market } });
  if (!r.ok) throw new Error('ebay search ' + r.status);
  const j = await r.json();
  return {
    source: 'eBay Browse API（出品中）',
    market,
    fetchedAt: new Date().toISOString(),
    total: j.total ?? 0,
    items: (j.itemSummaries || []).map((it) => {
      const ship = it.shippingOptions?.[0]?.shippingCost;
      return {
        title: it.title,
        price: it.price?.value ?? null,
        currency: it.price?.currency ?? null,
        shipping: ship ? ship.value : null, // null = 送料不明（配送先により変わる）
        condition: it.condition || null,
        url: it.itemWebUrl,
        image: it.image?.imageUrl || null,
        buyingOptions: it.buyingOptions || [],
        location: it.itemLocation?.country || null,
      };
    }),
  };
}
