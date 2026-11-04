// SourceRecord の保存（重複排除・価格履歴）と、成約例としての採用。
import { listAll, save, getOne } from './db';
import { mergeRecord, canAdoptAsSold, type SourceRecord } from '../core/records';
import type { MarketObservation } from '../core/types';

export async function upsertRecord(incoming: Omit<SourceRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<{ status: 'new' | 'updated' | 'unchanged'; record: SourceRecord }> {
  const all = await listAll<SourceRecord>('sourceRecords');
  const existing = all.find((r) => r.dedupeKey === incoming.dedupeKey);
  const { status, record } = mergeRecord(existing, incoming);
  if (status === 'unchanged' && existing) return { status, record: existing };
  const saved = await save<SourceRecord>('sourceRecords', record as SourceRecord);
  return { status, record: saved };
}

/** 照合確認済みの成約レコードを、既存の成約例（MarketObservation）として採用する */
export async function adoptAsSold(id: string): Promise<{ ok: boolean; reason: string }> {
  const rec = await getOne<SourceRecord>('sourceRecords', id);
  if (!rec) return { ok: false, reason: '見つかりません' };
  const chk = canAdoptAsSold(rec);
  if (!chk.ok) return chk;
  const o = await save<MarketObservation>('observations', {
    productId: rec.productId!, condition: rec.condition, kind: 'sold', url: rec.canonicalUrl, source: `${rec.source}（取り込み：${rec.method}）`,
    observedAt: rec.observedAt, soldAt: rec.soldAt, currency: rec.currency, price: rec.price, shipping: rec.shipping,
    region: rec.region, accessories: rec.accessories, isLot: false, adopted: true, excludeReason: '', note: rec.titleRaw.slice(0, 160),
  });
  await save<SourceRecord>('sourceRecords', { ...rec, adoptedObservationId: o.id });
  return { ok: true, reason: '' };
}
