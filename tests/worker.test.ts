import { describe, it, expect, beforeEach, vi } from 'vitest';
// @ts-ignore - plain JS worker
import worker from '../worker/worker.js';

const env = { YAHOO_APP_ID: 'y', EBAY_CLIENT_ID: 'id', EBAY_CLIENT_SECRET: 'sec', ALLOWED_ORIGIN: 'https://uenokun516-ai.github.io', APP_KEY: 'k' };
const ctx = { waitUntil: () => {} };
const req = (path: string, headers: Record<string, string> = { origin: env.ALLOWED_ORIGIN, 'x-app-key': 'k' }) =>
  new Request('https://w.example' + path, { headers });

beforeEach(() => {
  (globalThis as any).caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = vi.fn(async (u: any) => {
    const s = String(u);
    if (s.includes('yahooapis')) return new Response(JSON.stringify({ totalResultsAvailable: 1, hits: [{ name: 'テスト商品', price: 3980, condition: 'new', url: 'https://y/1', janCode: '4902370536485', image: { medium: 'i' } }] }));
    if (s.includes('oauth2/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 7200 }));
    if (s.includes('item_summary')) return new Response(JSON.stringify({ total: 2, itemSummaries: [{ title: 'Test', price: { value: '45.00', currency: 'USD' }, shippingOptions: [{ shippingCost: { value: '12.00' } }], itemWebUrl: 'https://e/1', condition: 'Used' }, { title: 'T2', price: { value: '50', currency: 'USD' }, itemWebUrl: 'https://e/2' }] }));
    return new Response('{}', { status: 404 });
  }) as any;
});

describe('中継サーバー', () => {
  it('Yahoo JAN検索を整形して返す', async () => {
    const r = await worker.fetch(req('/yahoo?jan=4902370536485'), env, ctx);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.items[0].name).toBe('テスト商品');
    expect(String((globalThis.fetch as any).mock.calls[0][0])).toContain('jan_code=4902370536485');
  });
  it('eBay は出品中として返し、送料不明は null', async () => {
    const j = await (await worker.fetch(req('/ebay?jan=4902370536485'), env, ctx)).json();
    expect(j.source).toContain('出品中');
    expect(j.items[0].shipping).toBe('12.00');
    expect(j.items[1].shipping).toBeNull();
  });
  it('許可していないオリジン・合言葉違いは拒否', async () => {
    expect((await worker.fetch(req('/yahoo?jan=1', { origin: 'https://evil.example', 'x-app-key': 'k' }), env, ctx)).status).toBe(403);
    expect((await worker.fetch(req('/yahoo?jan=1', { origin: env.ALLOWED_ORIGIN, 'x-app-key': 'x' }), env, ctx)).status).toBe(401);
  });
  it('キー未設定なら 501', async () => {
    const r = await worker.fetch(req('/ebay?jan=1'), { ...env, EBAY_CLIENT_ID: '' }, ctx);
    expect(r.status).toBe(501);
  });
});
