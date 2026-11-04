import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { save, listAll, trash, untrash, getSettings } from '../src/data/db';
import { exportBackup, restoreBackup, validateBackup, csvCell, toCsv } from '../src/data/backup';
import type { Product, ProductCode, EstimateSnapshot, InventoryItem } from '../src/core/types';

describe('受入テスト2・11：保存・バックアップ・復元', () => {
  it('先頭ゼロのコードと関連IDを復元後も維持', async () => {
    const p = await save<Product>('products', { nameJa: 'テスト', nameEn: 'Test', maker: '', platform: '', modelNumber: '', region: '', language: '', edition: '', color: '', searchTerms: '', imageAttachmentIds: [], checkedAt: null, note: '' });
    const c = await save<ProductCode>('productCodes', { productId: p.id, raw: '045496590420', normalized: '0045496590420', codeType: 'UPC-A', storeName: '', status: 'confirmed' });
    const est = await save<EstimateSnapshot>('estimates', { productId: p.id, candidateId: 'cand1', evidenceObservationIds: ['o1'], standardE: '1200' } as any);
    await save<InventoryItem>('inventory', { productId: p.id, estimateId: est.id } as any);

    const backup = JSON.parse(JSON.stringify(await exportBackup()));
    expect(backup.schemaVersion).toBe(1);
    // 消してから復元
    await trash('products', p.id);
    await restoreBackup(validateBackup(backup).ok ? backup : (null as any));
    const codes = await listAll<ProductCode>('productCodes');
    expect(codes[0].raw).toBe('045496590420');
    expect(codes[0].productId).toBe(p.id);
    const prods = await listAll<Product>('products');
    expect(prods.map((x) => x.id)).toContain(p.id);
    const inv = await listAll<InventoryItem>('inventory');
    expect(inv[0].estimateId).toBe(est.id);
    expect((await getSettings()).id).toBe('settings');
  });
  it('ゴミ箱経由の削除と戻し', async () => {
    const p = await save<Product>('products', { nameJa: 'X' } as any);
    await trash('products', p.id);
    expect((await listAll<Product>('products')).some((x) => x.id === p.id)).toBe(false);
    await untrash('products', p.id);
    expect((await listAll<Product>('products')).some((x) => x.id === p.id)).toBe(true);
  });
  it('不正なバックアップを拒否', () => {
    expect(validateBackup({ app: 'other' }).ok).toBe(false);
    expect(validateBackup({ app: 'ebay-sourcing-assistant', schemaVersion: 99, data: {} }).ok).toBe(false);
  });
});

describe('受入テスト11：CSVの数式注入対策', () => {
  it('= + - @ で始まる文字列を無害化', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-3000')).toBe('-3000');
    expect(csvCell('-1+2')).toBe("'-1+2");
  });
  it('BOM付きで出力', () => {
    expect(toCsv([{ a: 1 }]).startsWith('﻿a\r\n1')).toBe(true);
  });
});
