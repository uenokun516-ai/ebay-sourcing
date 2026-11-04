// IndexedDB による端末内保存。スマホとPCの自動同期はなし（単独端末利用）。
import { openDB, type IDBPDatabase } from 'idb';
import { DEFAULT_SETTINGS, type Base, type Settings } from '../core/types';

export const SCHEMA_VERSION = 2; // v2: sourceRecords を追加
export const DB_NAME = 'ebay-sourcing';

export const STORES = [
  'products',
  'productCodes',
  'observations',
  'candidates',
  'feeProfiles',
  'shippingQuotes',
  'fxRates',
  'estimates',
  'requests',
  'inventory',
  'saleEvents',
  'attachments',
  'sourceRecords',
] as const;
export type StoreName = (typeof STORES)[number];

let dbp: Promise<IDBPDatabase> | null = null;
export function db(name = DB_NAME) {
  if (!dbp) {
    dbp = openDB(name, SCHEMA_VERSION, {
      upgrade(d) {
        for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
      },
    });
  }
  return dbp;
}
export function resetDbHandle() {
  dbp = null;
}

export const nowIso = () => new Date().toISOString();
export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export async function listAll<T extends Base>(store: StoreName, includeDeleted = false): Promise<T[]> {
  const rows = (await (await db()).getAll(store)) as T[];
  return includeDeleted ? rows : rows.filter((r) => !r.deletedAt);
}

export async function getOne<T>(store: StoreName, id: string): Promise<T | undefined> {
  return (await (await db()).get(store, id)) as T | undefined;
}

export async function save<T extends Base>(store: StoreName, rec: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<Base>): Promise<T> {
  const t = nowIso();
  const full = { ...rec, id: rec.id ?? newId(), createdAt: rec.createdAt ?? t, updatedAt: t } as T;
  await (await db()).put(store, full);
  return full;
}

/** ゴミ箱へ移動（論理削除） */
export async function trash(store: StoreName, id: string) {
  const r = await getOne<Base>(store, id);
  if (r) await (await db()).put(store, { ...r, deletedAt: nowIso(), updatedAt: nowIso() });
}
export async function untrash(store: StoreName, id: string) {
  const r = await getOne<Base>(store, id);
  if (r) await (await db()).put(store, { ...r, deletedAt: null, updatedAt: nowIso() });
}
export async function purge(store: StoreName, id: string) {
  await (await db()).delete(store, id);
}

export async function getSettings(): Promise<Settings> {
  const s = (await (await db()).get('meta', 'settings')) as Settings | undefined;
  return { ...DEFAULT_SETTINGS, ...(s ?? {}), cautious: { ...DEFAULT_SETTINGS.cautious, ...(s?.cautious ?? {}) } };
}
export async function saveSettings(s: Settings, bumpVersion = true): Promise<Settings> {
  const next = { ...s, version: bumpVersion ? s.version + 1 : s.version, updatedAt: nowIso() };
  await (await db()).put('meta', next);
  return next;
}
