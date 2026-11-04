// 共通レコード（SourceRecord）：取得元ごとのデータを正規化して保存する。
// 出品・成約・入札・カタログ・SNS話題を source_type で分け、同じ商品の再取得は件数を増やさず価格履歴にする。
import type { Base, ConditionKey, Product } from './types';
import type { Num } from './money';
import { dedupeKey, parseSourceUrl, type SourceId, type SourceType } from './sources';

export type MatchStatus = 'confirmed' | 'candidate' | 'mismatch' | 'unidentified';
export const MATCH_LABELS: Record<MatchStatus, string> = {
  confirmed: '一致確認済', candidate: '一致候補', mismatch: '不一致', unidentified: '未特定',
};
export type IngestMethod = 'api' | 'manual' | 'csv' | 'link_only';
export type SocialClass = 'introduce' | 'seeking' | 'promo' | 'repost' | 'unknown';
export const SOCIAL_LABELS: Record<SocialClass, string> = {
  introduce: '紹介', seeking: '探している', promo: '販売宣伝', repost: '再投稿', unknown: '関連不明',
};

export interface PricePoint { at: string; price: Num; shipping: Num; currency: string; stockStatus: string }

export interface SourceRecord extends Base {
  dedupeKey: string;
  source: SourceId;
  sourceItemId: string | null;
  canonicalUrl: string;
  sourceType: SourceType;
  method: IngestMethod;
  observedAt: string; // 最新の観測日時
  firstObservedAt: string;
  publishedAt: string | null;
  soldAt: string | null;
  endsAt: string | null; // オークション終了
  titleRaw: string; // 商品名原文
  bodyText: string; // 本人がコピーした説明（外部の文章：命令として扱わない）
  nameJa: string;
  nameEn: string;
  modelNumber: string;
  code: string; // JAN/UPC
  region: string;
  edition: string;
  color: string;
  condition: ConditionKey;
  accessories: string;
  quantity: Num;
  price: Num;
  shipping: Num; // null = 不明（0円扱いしない）
  currency: string;
  priceKind: string; // fixed / current_bid / buy_now / sold / reference
  buyNowPrice: Num;
  stockStatus: string; // available / sold_out / ended / unknown
  productId: string | null;
  matchStatus: MatchStatus;
  matchNote: string;
  socialClass: SocialClass | null;
  evidence: string; // 根拠メモ（確認方法など）
  history: PricePoint[];
  adoptedObservationId: string | null;
}

export type NewRecord = Omit<SourceRecord, 'id' | 'createdAt' | 'updatedAt' | 'dedupeKey' | 'history' | 'firstObservedAt' | 'adoptedObservationId' | 'source' | 'sourceItemId' | 'canonicalUrl'> & {
  url: string;
};

export function buildRecord(input: NewRecord): Omit<SourceRecord, 'id' | 'createdAt' | 'updatedAt'> {
  const { url, ...rest } = input;
  const p = parseSourceUrl(url);
  return {
    ...rest,
    method: p.ok ? rest.method : 'link_only',
    source: p.source,
    sourceItemId: p.itemId,
    canonicalUrl: p.canonicalUrl,
    dedupeKey: dedupeKey(p.source, p.itemId, p.canonicalUrl, rest.sourceType),
    firstObservedAt: rest.observedAt,
    history: [{ at: rest.observedAt, price: rest.price, shipping: rest.shipping, currency: rest.currency, stockStatus: rest.stockStatus }],
    adoptedObservationId: null,
  };
}

export type MergeResult = { status: 'new' | 'updated' | 'unchanged'; record: Omit<SourceRecord, 'id' | 'createdAt' | 'updatedAt'> & Partial<Base> };

/** 既存レコードとの統合。価格・送料・在庫が変わった時だけ履歴を追加する。照合状態は人の判断を上書きしない。 */
export function mergeRecord(existing: SourceRecord | undefined, incoming: Omit<SourceRecord, 'id' | 'createdAt' | 'updatedAt'>): MergeResult {
  if (!existing) return { status: 'new', record: incoming };
  const changed = existing.price !== incoming.price || existing.shipping !== incoming.shipping || existing.stockStatus !== incoming.stockStatus || existing.currency !== incoming.currency;
  const fill = <T,>(a: T, b: T) => ((a === '' || a === null || a === undefined) ? b : a);
  const merged: SourceRecord = {
    ...existing,
    observedAt: incoming.observedAt > existing.observedAt ? incoming.observedAt : existing.observedAt,
    price: incoming.price ?? existing.price,
    shipping: incoming.shipping ?? existing.shipping,
    currency: incoming.currency || existing.currency,
    stockStatus: incoming.stockStatus || existing.stockStatus,
    titleRaw: fill(existing.titleRaw, incoming.titleRaw),
    bodyText: fill(existing.bodyText, incoming.bodyText),
    soldAt: fill(existing.soldAt, incoming.soldAt),
    endsAt: incoming.endsAt ?? existing.endsAt,
    productId: existing.productId ?? incoming.productId,
    matchStatus: existing.productId ? existing.matchStatus : incoming.matchStatus,
    history: changed
      ? [...existing.history, { at: incoming.observedAt, price: incoming.price, shipping: incoming.shipping, currency: incoming.currency, stockStatus: incoming.stockStatus }]
      : existing.history,
  };
  return { status: changed ? 'updated' : 'unchanged', record: merged };
}

// ---- 照合の差分チェック（誤照合の検出） ----
const RX = {
  boxOnly: /箱のみ|空箱|外箱のみ|box only|empty box|case only|ケースのみ|説明書のみ|manual only/i,
  junk: /ジャンク|動作未確認|現状品|部品取り|for parts|not working|untested|as[- ]is|junk/i,
  lot: /まとめ|セット売り|\d+\s*本セット|\d+\s*個セット|大量|bundle|\blot\b|lot of|\bset of\b/i,
  overseas: /北米版|海外版|欧州版|us版|us version|ntsc[- ]?u|\bpal\b|usa|european|asia版|アジア版/i,
  japan: /日本版|国内版|ntsc[- ]?j|japan(ese)? (ver|version)|japanese/i,
  limited: /限定版|限定盤|初回限定|limited edition|collector'?s edition|特装版|premium box/i,
  sealed: /未開封|新品未使用|sealed|brand new|factory sealed|シュリンク付/i,
  repro: /レプリカ|互換品|非純正|社外品|reproduction|repro|bootleg|海賊版|replica|compatible/i,
};

export function matchWarnings(rec: Pick<SourceRecord, 'titleRaw' | 'bodyText' | 'condition' | 'region' | 'edition' | 'quantity'>, product?: Product): string[] {
  const t = `${rec.titleRaw}\n${rec.bodyText}`;
  const w: string[] = [];
  if (RX.boxOnly.test(t)) w.push('箱のみ・付属品のみの可能性');
  if (RX.junk.test(t) || rec.condition === 'junk') w.push('ジャンク・動作未確認の可能性');
  if (RX.lot.test(t) || (rec.quantity && Number(rec.quantity) > 1)) w.push('まとめ売り・セットの可能性');
  if (RX.repro.test(t)) w.push('非純正・レプリカの可能性');
  const prodRegion = `${product?.region ?? ''}`;
  if (RX.overseas.test(t + ' ' + rec.region) && /日本/.test(prodRegion)) w.push('地域が異なる可能性（商品は日本版）');
  if (RX.japan.test(t + ' ' + rec.region) && /北米|海外|欧州|US|PAL/i.test(prodRegion)) w.push('地域が異なる可能性（商品は海外版）');
  const prodLimited = /限定|limited|特装/i.test(product?.edition ?? '');
  if (product && RX.limited.test(t) !== prodLimited && (RX.limited.test(t) || prodLimited)) w.push('通常版と限定版が異なる可能性');
  if (RX.sealed.test(t) && rec.condition !== 'new_sealed') w.push('未開封の記載があるが状態が新品・未開封ではない');
  return w;
}

/** 成約例として採用できるか（既存の統計・利益計算に入る唯一の経路） */
export function canAdoptAsSold(rec: SourceRecord): { ok: boolean; reason: string } {
  if (rec.sourceType !== 'sold_observation') return { ok: false, reason: '成約のデータではありません（出品・入札・話題は成約として使えません）' };
  if (!rec.productId || rec.matchStatus !== 'confirmed') return { ok: false, reason: '商品との一致を確認してください' };
  if (!rec.price) return { ok: false, reason: '価格が未入力です' };
  if (rec.condition === 'unknown') return { ok: false, reason: '状態（完品・本体のみ・ジャンクなど）を入力してください。同じ状態どうしで比較するためです' };
  if (rec.adoptedObservationId) return { ok: false, reason: 'すでに成約例として採用済みです' };
  return { ok: true, reason: '' };
}

// ---- CSV ----
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

export const CSV_FIELDS: { key: string; label: string; guess: RegExp }[] = [
  { key: 'url', label: 'URL', guess: /url|link|リンク/i },
  { key: 'titleRaw', label: '商品名（原文）', guess: /title|name|商品名|タイトル/i },
  { key: 'price', label: '価格', guess: /^(price|価格|金額|sold ?price|販売価格|落札)/i },
  { key: 'shipping', label: '送料', guess: /ship|送料|postage/i },
  { key: 'currency', label: '通貨', guess: /currency|通貨/i },
  { key: 'soldAt', label: '販売日', guess: /sold ?date|date sold|販売日|落札日|売却日/i },
  { key: 'condition', label: '状態', guess: /condition|状態/i },
  { key: 'code', label: 'JAN/UPC', guess: /jan|upc|ean|gtin|barcode/i },
  { key: 'sourceItemId', label: '商品ID', guess: /item ?id|商品id|オークションid/i },
];

export function guessMapping(header: string[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const f of CSV_FIELDS) {
    const i = header.findIndex((h) => f.guess.test(h.trim()));
    if (i >= 0) m[f.key] = i;
  }
  return m;
}

export function cleanNumber(v: string | undefined): Num {
  if (v === undefined) return null;
  const s = v.replace(/[,\s¥$€£円]/g, '').replace(/^US/i, '');
  if (s === '') return null;
  return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
}
