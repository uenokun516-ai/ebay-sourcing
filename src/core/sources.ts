// 取得元（サービス）の定義・データ取得検証表・URL正規化。
// 検証表の内容は docs/data-source-verification.md と同じ。実装時の再確認で更新すること。

export type SourceId = 'ebay' | 'yahoo_auction' | 'yahoo_shopping' | 'mercari' | 'amazon' | 'x' | 'youtube' | 'other';
export type SourceType = 'active_listing' | 'sold_observation' | 'auction_bid' | 'catalog_reference' | 'social_signal';
export type ConnStatus = 'unverified' | 'available' | 'awaiting_setup' | 'manual_only' | 'unavailable';

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  active_listing: '出品中',
  sold_observation: '成約（売れた）',
  auction_bid: 'オークション入札中',
  catalog_reference: 'カタログ・参考価格',
  social_signal: 'SNS・動画の話題',
};
export const CONN_STATUS_LABELS: Record<ConnStatus, string> = {
  unverified: '未検証',
  available: '利用可能',
  awaiting_setup: '設定待ち',
  manual_only: '手動のみ',
  unavailable: '利用不可',
};
export const SOURCE_LABELS: Record<SourceId, string> = {
  ebay: 'eBay', yahoo_auction: 'Yahoo!オークション', yahoo_shopping: 'Yahoo!ショッピング', mercari: 'メルカリ',
  amazon: 'Amazon', x: 'X', youtube: 'YouTube', other: 'その他',
};

export interface VerificationRow {
  source: SourceId;
  role: string;
  method: string; // 取得方式
  status: ConnStatus;
  types: SourceType[];
  prerequisites: string; // アカウント/権限/費用
  limits: string;
  obtained: string; // 取得できる項目・欠損
  evidence: { title: string; url: string }[];
  checkedAt: string;
  realDataVerified: boolean; // 実データでの接続確認
  note: string;
}

export const VERIFICATION: VerificationRow[] = [
  {
    source: 'ebay', role: '海外の出品・競合（成約は手動）', method: '公式API（Browse API）＋成約は手動入力', status: 'awaiting_setup',
    types: ['active_listing', 'sold_observation'],
    prerequisites: 'eBay Developers Program（無料）の Production キー。中継サーバー（Cloudflare Workers 無料枠）',
    limits: 'Browse API は出品中のみ。成約履歴の Marketplace Insights API は限定公開のため使わない',
    obtained: '出品のタイトル・価格・送料（不明あり）・状態・URL・件数。成約価格・販売日は取得できない',
    evidence: [
      { title: 'Browse API', url: 'https://developer.ebay.com/develop/api/buy/browse_api' },
      { title: 'Marketplace Insights API（Limited Release）', url: 'https://developer.ebay.com/api-docs/buy/marketplace-insights/overview.html' },
    ],
    checkedAt: '2026-11-04', realDataVerified: false, note: 'コード・模擬データでのテスト済み。実キー未設定',
  },
  {
    source: 'yahoo_shopping', role: '商品同定（JAN→商品名）・国内新品価格', method: '公式API（商品検索 v3）', status: 'awaiting_setup',
    types: ['catalog_reference'],
    prerequisites: 'Yahoo!デベロッパーネットワークの Client ID（無料）。ガイドライン同意',
    limits: '短時間の大量アクセスは一時停止の対象（目安 1クエリ/秒）',
    obtained: '商品名・価格・画像・JAN・新品/中古区分。レトロ品は見つからないことが多い',
    evidence: [{ title: '商品検索（v3）', url: 'https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html' }],
    checkedAt: '2026-11-04', realDataVerified: false, note: 'コード・模擬データでのテスト済み。実キー未設定',
  },
  {
    source: 'yahoo_auction', role: '国内候補・現在入札額・即決価格', method: '手動取り込み（URL＋本文）＋検索リンク', status: 'manual_only',
    types: ['auction_bid', 'sold_observation'],
    prerequisites: 'なし',
    limits: '公式オークションWeb APIは2018〜2020年に提供終了',
    obtained: '本人がコピーした価格・終了時刻・即決価格・本文。自動取得なし',
    evidence: [{ title: 'ヤフオクのお知らせ（API提供終了）', url: 'https://developer.yahoo.co.jp/changelog/auctions.html' }],
    checkedAt: '2026-11-04', realDataVerified: false, note: '現在入札額は仕入れ確定額として扱わない',
  },
  {
    source: 'mercari', role: '国内候補・状態・価格', method: '手動取り込み（URL＋本文）＋検索リンク', status: 'manual_only',
    types: ['active_listing'],
    prerequisites: 'なし',
    limits: '一般向けの公式検索APIは確認できず。自動収集は行わない',
    obtained: '本人がコピーした価格・状態・本文',
    evidence: [{ title: 'メルカリ利用規約', url: 'https://static.jp.mercari.com/tos' }],
    checkedAt: '2026-11-04', realDataVerified: false, note: '売り切れ表示は成約価格とは限らない',
  },
  {
    source: 'amazon', role: '型番・新品価格の補助', method: '手動取り込み＋検索リンク（API未接続）', status: 'unverified',
    types: ['catalog_reference'],
    prerequisites: 'Creators API はアソシエイト・プログラム内で提供。この用途で使える根拠が未確認',
    limits: 'PA-API は2026年5月15日に廃止',
    obtained: '—（未接続）',
    evidence: [{ title: 'アソシエイト利用条件', url: 'https://affiliate-program.amazon.com/help/operating/policies' }],
    checkedAt: '2026-11-04', realDataVerified: false, note: '利用条件を確認できるまで接続しない',
  },
  {
    source: 'x', role: '海外の探し物・話題（調査のきっかけ）', method: '手動取り込みのみ（API は使わない）', status: 'manual_only',
    types: ['social_signal'],
    prerequisites: '利用者の判断で予算0円（2026-11-04）。API には接続しない',
    limits: 'X API は2026年2月から従量課金が標準（無料枠なし）',
    obtained: '本人が手動で取り込んだ投稿URL・本文のみ',
    evidence: [{ title: 'X 開発者プラットフォーム', url: 'https://developer.x.com/' }],
    checkedAt: '2026-11-04', realDataVerified: false, note: '自動DM・自動返信は実装しない',
  },
  {
    source: 'youtube', role: '商品紹介・コレクターの関心（調査のきっかけ）', method: '公式API（Data API v3）候補／現状は手動取り込み', status: 'awaiting_setup',
    types: ['social_signal'],
    prerequisites: 'Google Cloud プロジェクトと APIキー（無料）',
    limits: '既定で1日10,000ユニット。search.list は1日100回まで',
    obtained: '—（未接続）。取得できるのはタイトル・説明・公開日時・統計などのメタデータのみ',
    evidence: [{ title: 'YouTube Data API の概要（利用枠）', url: 'https://developers.google.com/youtube/v3/getting-started' }],
    checkedAt: '2026-11-04', realDataVerified: false, note: '動画の内容を見たとは扱わない',
  },
];

// ---- URL 正規化と商品ID抽出 ----
const TRACKING = /^(utm_|fbclid$|gclid$|mkcid$|mkrid$|mkevt$|campid$|toolid$|customid$|_trkparms$|_trksid$|hash$|ref$|ref_$|psc$|afid$|sid$|si$|s$|t$)/i;

export interface ParsedUrl { source: SourceId; itemId: string | null; canonicalUrl: string; ok: boolean }

export function parseSourceUrl(raw: string): ParsedUrl {
  let u: URL;
  try {
    u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol');
  } catch {
    return { source: 'other', itemId: null, canonicalUrl: raw.trim(), ok: false };
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let source: SourceId = 'other';
  let itemId: string | null = null;
  let m: RegExpMatchArray | null;
  const keep = new Set<string>();

  if (/(^|\.)ebay\.[a-z.]+$/.test(host)) {
    source = 'ebay';
    if ((m = u.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})/))) itemId = m[1];
    keep.add('var'); // 出品のバリエーション
  } else if (/auctions\.yahoo\.co\.jp$|page\.auctions\.yahoo\.co\.jp$/.test(host)) {
    source = 'yahoo_auction';
    if ((m = u.pathname.match(/\/auction\/([a-z]?\d+)/i))) itemId = m[1].toLowerCase();
  } else if (/shopping\.yahoo\.co\.jp$|store\.shopping\.yahoo\.co\.jp$/.test(host)) {
    source = 'yahoo_shopping';
    if ((m = u.pathname.match(/^\/([^/]+)\/([^/.]+)\.html/))) itemId = m[1] + ':' + m[2];
  } else if (/mercari\.com$/.test(host)) {
    source = 'mercari';
    if ((m = u.pathname.match(/\/(?:item|shops\/product)\/([A-Za-z0-9]+)/))) itemId = m[1];
  } else if (/amazon\.(co\.jp|com)$/.test(host)) {
    source = 'amazon';
    if ((m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/))) itemId = m[1];
  } else if (/^(x|twitter)\.com$/.test(host)) {
    source = 'x';
    if ((m = u.pathname.match(/\/status\/(\d+)/))) itemId = m[1];
  } else if (/youtube\.com$|youtu\.be$/.test(host)) {
    source = 'youtube';
    if (host === 'youtu.be') itemId = u.pathname.slice(1).split('/')[0] || null;
    else if ((m = u.pathname.match(/\/(?:shorts|live|embed)\/([\w-]{11})/))) itemId = m[1];
    else itemId = u.searchParams.get('v');
    keep.add('v');
  }

  // 追跡パラメーターを除く（商品同定に必要なものは残す）
  const params = new URLSearchParams();
  for (const [k, v] of u.searchParams) if (keep.has(k) || (!TRACKING.test(k) && source === 'other')) params.set(k, v);
  let canonical: string;
  if (source === 'ebay' && itemId) canonical = `https://www.ebay.com/itm/${itemId}`;
  else if (source === 'amazon' && itemId) canonical = `https://www.${host}/dp/${itemId}`;
  else if (source === 'youtube' && itemId) canonical = `https://www.youtube.com/watch?v=${itemId}`;
  else if (source === 'x' && itemId) canonical = `https://x.com/i/status/${itemId}`;
  else if (source === 'mercari' && itemId) canonical = `https://jp.mercari.com/item/${itemId}`;
  else canonical = `${u.protocol}//${u.hostname}${u.pathname.replace(/\/+$/, '')}${params.toString() ? '?' + params : ''}`;
  if (source === 'ebay' && itemId && params.get('var')) canonical += `?var=${params.get('var')}`;
  return { source, itemId, canonicalUrl: canonical, ok: true };
}

/** 重複排除のキー：サイト＋商品ID（なければ正規化URL） */
export function dedupeKey(source: SourceId, itemId: string | null, canonicalUrl: string, type: SourceType): string {
  return `${type}|${source}|${itemId ?? canonicalUrl}`;
}
