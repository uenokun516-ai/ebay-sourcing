import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { parseSourceUrl } from '../src/core/sources';
import { buildRecord, mergeRecord, matchWarnings, canAdoptAsSold, parseCsv, guessMapping, cleanNumber, type NewRecord, type SourceRecord } from '../src/core/records';
import { upsertRecord, adoptAsSold } from '../src/data/records';
import { listAll, save } from '../src/data/db';
import { validateBackup } from '../src/data/backup';
import { computeStats } from '../src/core/stats';
import type { MarketObservation, Product } from '../src/core/types';

const base = (p: Partial<NewRecord> = {}): NewRecord => ({
  url: 'https://www.ebay.com/itm/Game-Boy-Light/123456789012?_trkparms=abc&hash=item1&var=5', sourceType: 'sold_observation', method: 'manual',
  observedAt: '2026-11-04T00:00:00.000Z', publishedAt: null, soldAt: '2026-11-01T00:00:00.000Z', endsAt: null,
  titleRaw: 'Nintendo Game Boy Light Silver Japan', bodyText: '', nameJa: '', nameEn: '', modelNumber: '', code: '', region: '', edition: '', color: '',
  condition: 'used_loose', accessories: '', quantity: '1', price: '180', shipping: '20', currency: 'USD', priceKind: 'sold', buyNowPrice: null,
  stockStatus: 'sold_out', productId: null, matchStatus: 'unidentified', matchNote: '', socialClass: null, evidence: '', ...p,
});

describe('URL正規化と商品ID', () => {
  it('eBay：追跡パラメーターを除き、バリエーションは保持', () => {
    const r = parseSourceUrl('https://www.ebay.com/itm/Game-Boy-Light/123456789012?_trkparms=abc&hash=item1&var=5');
    expect(r.source).toBe('ebay');
    expect(r.itemId).toBe('123456789012');
    expect(r.canonicalUrl).toBe('https://www.ebay.com/itm/123456789012?var=5');
  });
  it('各サイトの商品ID', () => {
    expect(parseSourceUrl('https://page.auctions.yahoo.co.jp/jp/auction/x1234567890?utm_source=a').itemId).toBe('x1234567890');
    expect(parseSourceUrl('https://jp.mercari.com/item/m12345678901').itemId).toBe('m12345678901');
    expect(parseSourceUrl('https://www.amazon.co.jp/dp/B0ABCDEFGH/ref=sr_1').canonicalUrl).toBe('https://www.amazon.co.jp/dp/B0ABCDEFGH');
    expect(parseSourceUrl('https://youtu.be/dQw4w9WgXcQ?si=xx').canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(parseSourceUrl('https://x.com/someone/status/1790000000000000000?s=20').itemId).toBe('1790000000000000000');
  });
  it('URLとして解析できなければリンクのみ', () => {
    expect(buildRecord(base({ url: 'これはURLではない' })).method).toBe('link_only');
  });
});

describe('受入条件2：再取得で件数が増えず、価格変更は履歴', () => {
  it('同じ商品IDは1件のまま、価格変化だけ履歴に追加', async () => {
    const a = await upsertRecord(buildRecord(base({ sourceType: 'active_listing', priceKind: 'fixed', stockStatus: 'available', soldAt: null })));
    const b = await upsertRecord(buildRecord(base({ url: 'https://ebay.com/itm/123456789012?var=5&mkevt=1', sourceType: 'active_listing', priceKind: 'fixed', stockStatus: 'available', soldAt: null, observedAt: '2026-11-05T00:00:00.000Z' })));
    const c = await upsertRecord(buildRecord(base({ sourceType: 'active_listing', priceKind: 'fixed', stockStatus: 'available', soldAt: null, price: '170', observedAt: '2026-11-06T00:00:00.000Z' })));
    expect(a.status).toBe('new');
    expect(b.status).toBe('unchanged');
    expect(c.status).toBe('updated');
    const all = (await listAll<SourceRecord>('sourceRecords')).filter((r) => r.sourceType === 'active_listing');
    expect(all.length).toBe(1);
    expect(all[0].history.map((h) => h.price)).toEqual(['180', '170']);
  });
  it('出品と成約は同じURLでも別種として保存（混同しない）', () => {
    const l = buildRecord(base({ sourceType: 'active_listing' }));
    const s = buildRecord(base({ sourceType: 'sold_observation' }));
    expect(l.dedupeKey).not.toBe(s.dedupeKey);
  });
  it('人が付けた照合状態は再取得で上書きしない', () => {
    const ex = { ...buildRecord(base()), id: 'r1', createdAt: '', updatedAt: '', productId: 'p1', matchStatus: 'confirmed' } as SourceRecord;
    const m = mergeRecord(ex, buildRecord(base({ matchStatus: 'candidate', productId: 'p2' })));
    expect(m.record.productId).toBe('p1');
    expect(m.record.matchStatus).toBe('confirmed');
  });
});

describe('受入条件3：誤照合の検出', () => {
  const prod = { region: '日本版', edition: '通常版' } as Product;
  it('箱のみ・ジャンク・別地域・まとめ売り・限定版', () => {
    expect(matchWarnings({ titleRaw: 'ゲームボーイライト 箱のみ', bodyText: '', condition: 'other', region: '', edition: '', quantity: '1' }, prod).join()).toContain('箱のみ');
    expect(matchWarnings({ titleRaw: 'Game Boy Light for parts not working', bodyText: '', condition: 'unknown', region: '', edition: '', quantity: '1' }, prod).join()).toContain('ジャンク');
    expect(matchWarnings({ titleRaw: 'Pokemon Red US version', bodyText: '', condition: 'unknown', region: '', edition: '', quantity: '1' }, prod).join()).toContain('地域');
    expect(matchWarnings({ titleRaw: 'Famicom games lot of 10', bodyText: '', condition: 'unknown', region: '', edition: '', quantity: '1' }, prod).join()).toContain('まとめ');
    expect(matchWarnings({ titleRaw: '初回限定版 特典付き', bodyText: '', condition: 'unknown', region: '', edition: '', quantity: '1' }, prod).join()).toContain('限定版');
  });
  it('問題のない記載では警告なし', () => {
    expect(matchWarnings({ titleRaw: 'Game Boy Light Silver Japanese', bodyText: '', condition: 'used_loose', region: '', edition: '', quantity: '1' }, prod)).toEqual([]);
  });
});

describe('受入条件1：成約以外・未確認は既存の統計に入らない', () => {
  it('出品・SNSは成約として採用できない', () => {
    const r = { ...buildRecord(base({ sourceType: 'active_listing', productId: 'p', matchStatus: 'confirmed' })), id: 'x', createdAt: '', updatedAt: '' } as SourceRecord;
    expect(canAdoptAsSold(r).ok).toBe(false);
    const s = { ...buildRecord(base({ sourceType: 'social_signal', productId: 'p', matchStatus: 'confirmed' })), id: 'y', createdAt: '', updatedAt: '' } as SourceRecord;
    expect(canAdoptAsSold(s).ok).toBe(false);
  });
  it('一致確認済みの成約だけ採用され、統計に1件入る（2回目は拒否）', async () => {
    const p = await save<Product>('products', { nameJa: 'GBL' } as any);
    const { record } = await upsertRecord(buildRecord(base({ url: 'https://www.ebay.com/itm/999999999999', productId: p.id, matchStatus: 'candidate' })));
    expect((await adoptAsSold(record.id)).ok).toBe(false); // 候補のまま
    await save<SourceRecord>('sourceRecords', { ...record, matchStatus: 'confirmed' });
    expect((await adoptAsSold(record.id)).ok).toBe(true);
    expect((await adoptAsSold(record.id)).ok).toBe(false);
    const obs = (await listAll<MarketObservation>('observations')).filter((o) => o.productId === p.id);
    const st = computeStats(obs, { condition: 'used_loose', windowDays: 90, staleDays: 30, minComparable: 5, now: new Date('2026-11-05') });
    expect(st.n).toBe(1);
  });
  it('送料不明は null のまま（0円にならない）', () => {
    expect(buildRecord(base({ shipping: null })).shipping).toBeNull();
  });
});

describe('CSV取り込み', () => {
  it('引用符・改行・BOMを解析し、列を推定', () => {
    const rows = parseCsv('﻿Title,Sold Price,Shipping,Sold Date,URL\r\n"Game Boy, Light",US $180.00,$20.00,2026-11-01,https://www.ebay.com/itm/111111111111\r\n"He said ""hi""",50,,2026-10-30,\r\n');
    expect(rows.length).toBe(3);
    expect(rows[1][0]).toBe('Game Boy, Light');
    expect(rows[2][0]).toBe('He said "hi"');
    const m = guessMapping(rows[0]);
    expect(m.price).toBe(1);
    expect(m.shipping).toBe(2);
    expect(m.url).toBe(4);
    expect(cleanNumber(rows[1][1])).toBe('180.00');
    expect(cleanNumber(rows[2][2])).toBeNull();
  });
});

describe('バックアップの互換性', () => {
  it('v1（sourceRecordsなし）のバックアップも受け付ける', () => {
    const v1 = { app: 'ebay-sourcing-assistant', schemaVersion: 1, exportedAt: '', settings: {}, data: { products: [] } };
    expect(validateBackup(v1).ok).toBe(true);
  });
});
