// 相場統計：同条件・採用済み・成約の観測値のみから算出。注意事項（少数・重複・外れ値・送料不明・古さ）を必ず返す。
import Decimal from 'decimal.js';
import type { ConditionKey, MarketObservation } from './types';
import { toDec } from './money';

export interface StatsResult {
  currency: string | null;
  used: MarketObservation[];
  excluded: { obs: MarketObservation; reason: string }[];
  n: number;
  mean: Decimal | null; // 商品代＋送料
  median: Decimal | null;
  min: Decimal | null;
  max: Decimal | null;
  latestObservedAt: string | null;
  warnings: string[];
}

function median(xs: Decimal[]): Decimal | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a.comparedTo(b));
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : s[mid - 1].plus(s[mid]).div(2);
}

function quantile(sorted: Decimal[], q: number): Decimal {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo].plus(sorted[hi].minus(sorted[lo]).times(pos - lo));
}

export function computeStats(
  all: MarketObservation[],
  opts: { condition: ConditionKey; now?: Date; windowDays: number; staleDays: number; minComparable: number },
): StatsResult {
  const now = opts.now ?? new Date();
  const excluded: { obs: MarketObservation; reason: string }[] = [];
  const warnings: string[] = [];
  const cand: MarketObservation[] = [];
  const windowStart = now.getTime() - opts.windowDays * 86400000;

  for (const o of all) {
    if (o.deletedAt) continue;
    if (!o.adopted) { excluded.push({ obs: o, reason: o.excludeReason || '手動で除外' }); continue; }
    if (o.kind !== 'sold') { excluded.push({ obs: o, reason: '出品中（成約ではない）' }); continue; }
    if (o.condition !== opts.condition) { excluded.push({ obs: o, reason: '状態が異なる' }); continue; }
    if (o.isLot) { excluded.push({ obs: o, reason: 'まとめ売り' }); continue; }
    if (!toDec(o.price)) { excluded.push({ obs: o, reason: '価格未入力' }); continue; }
    const d = o.soldAt ?? o.observedAt;
    if (d && new Date(d).getTime() < windowStart) { excluded.push({ obs: o, reason: `調査期間（${opts.windowDays}日）外` }); continue; }
    cand.push(o);
  }

  // 通貨は最多のものに揃える（混在は換算せず除外）
  const counts = new Map<string, number>();
  cand.forEach((o) => counts.set(o.currency, (counts.get(o.currency) ?? 0) + 1));
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const seen = new Set<string>();
  const used: MarketObservation[] = [];
  let shipUnknown = 0;
  for (const o of cand) {
    if (o.currency !== currency) { excluded.push({ obs: o, reason: '通貨が異なる' }); continue; }
    const key = o.url.trim() ? 'u:' + o.url.trim() : `p:${o.soldAt}|${o.price}|${o.shipping}`;
    if (seen.has(key)) { excluded.push({ obs: o, reason: '同一成約の重複' }); continue; }
    seen.add(key);
    if (!toDec(o.shipping) && o.shipping !== '0') shipUnknown++;
    used.push(o);
  }
  if (shipUnknown) warnings.push(`送料不明 ${shipUnknown}件（合計額の統計から除外）`);
  if (excluded.some((e) => e.reason === '同一成約の重複')) warnings.push('重複した成約を除外しました');

  const totals = used
    .filter((o) => toDec(o.shipping) || o.shipping === '0')
    .map((o) => toDec(o.price)!.plus(toDec(o.shipping) ?? 0));
  const sorted = [...totals].sort((a, b) => a.comparedTo(b));

  if (sorted.length >= 4) {
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3.minus(q1);
    const lo = q1.minus(iqr.times(1.5));
    const hi = q3.plus(iqr.times(1.5));
    const out = sorted.filter((v) => v.lt(lo) || v.gt(hi)).length;
    if (out) warnings.push(`外れ値の可能性 ${out}件（統計には含めています。内容を確認してください）`);
  }
  if (used.length < opts.minComparable) warnings.push(`比較可能な成約例が少数（${used.length}件 / 目安${opts.minComparable}件）`);

  const latest = used.map((o) => o.observedAt).filter(Boolean).sort().at(-1) ?? null;
  if (latest && now.getTime() - new Date(latest).getTime() > opts.staleDays * 86400000) {
    warnings.push(`相場の確認日が${opts.staleDays}日より古い`);
  }
  if (!used.length) warnings.push('採用できる成約例がありません');

  const mean = sorted.length ? sorted.reduce((a, b) => a.plus(b), new Decimal(0)).div(sorted.length) : null;
  return {
    currency,
    used,
    excluded,
    n: used.length,
    mean,
    median: median(sorted),
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
    latestObservedAt: latest,
    warnings,
  };
}
