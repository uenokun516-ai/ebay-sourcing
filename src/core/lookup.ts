// ネット検索（Phase 2）：中継サーバー経由の公式API呼び出しと、各サイトの検索リンク。
// 取得結果は「参考」。成約価格・販売件数・純正判定の代わりにはしない。

export interface YahooItem { name: string; price: number; condition: string; url: string; image: string | null; janCode: string | null; brand: string | null; seller: string | null }
export interface YahooResult { source: string; fetchedAt: string; total: number | null; items: YahooItem[] }
export interface EbayItem { title: string; price: string | null; currency: string | null; shipping: string | null; condition: string | null; url: string; image: string | null; buyingOptions: string[]; location: string | null }
export interface EbayResult { source: string; market: string; fetchedAt: string; total: number; items: EbayItem[] }

export class LookupError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const ERROR_TEXT: Record<string, string> = {
  yahoo_not_configured: '中継サーバーに Yahoo! の Client ID が設定されていません',
  ebay_not_configured: '中継サーバーに eBay のキーが設定されていません',
  origin_not_allowed: '中継サーバーの ALLOWED_ORIGIN がこのアプリのURLと一致しません',
  bad_app_key: '合言葉（APP_KEY）が中継サーバーと一致しません',
  upstream_error: '検索先のサービスでエラーが起きました（時間をおいて再試行してください）',
};

export async function callWorker<T>(base: string, appKey: string, path: string, params: Record<string, string>, timeoutMs = 12000): Promise<T> {
  if (!base) throw new LookupError('no_worker', '中継サーバーが未設定です（その他 → 設定）');
  if (!navigator.onLine) throw new LookupError('offline', 'オフラインのためネット検索は使えません');
  let u: URL;
  try { u = new URL(path, base.endsWith('/') ? base : base + '/'); } catch { throw new LookupError('bad_url', '中継サーバーのURLが正しくありません'); }
  if (u.protocol !== 'https:') throw new LookupError('bad_url', '中継サーバーは https のURLにしてください');
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(u, { headers: appKey ? { 'x-app-key': appKey } : {}, signal: ac.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new LookupError(j.error || 'http_' + r.status, ERROR_TEXT[j.error] || `検索に失敗しました（${r.status}）`);
    return j as T;
  } catch (e) {
    if (e instanceof LookupError) throw e;
    throw new LookupError('network', (e as Error).name === 'AbortError' ? '時間切れになりました' : '中継サーバーに接続できませんでした');
  } finally {
    clearTimeout(t);
  }
}

export function searchLinks(code: string, keyword: string): { label: string; url: string; note: string }[] {
  const kw = (keyword || code).trim();
  const e = encodeURIComponent;
  const links = [
    { label: 'eBay 売却済み', url: `https://www.ebay.com/sch/i.html?_nkw=${e(keyword || code)}&LH_Sold=1&LH_Complete=1`, note: '成約例の確認（英語名が当たりやすい）' },
    { label: 'ヤフオク 落札相場', url: `https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=${e(kw)}`, note: '国内の落札額' },
    { label: 'メルカリ', url: `https://jp.mercari.com/search?keyword=${e(kw)}&status=sold_out`, note: '売り切れ表示（成約とは限らない）' },
    { label: 'Amazon', url: `https://www.amazon.co.jp/s?k=${e(code || kw)}`, note: '型番・新品価格の補助' },
    { label: 'Google', url: `https://www.google.com/search?q=${e(code ? `"${code}"` : kw)}`, note: '商品名の特定' },
  ];
  return links;
}

/** 数値の中央値（文字列可） */
export function medianOf(xs: (string | number | null)[]): number | null {
  const v = xs.map(Number).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
