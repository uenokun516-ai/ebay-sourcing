// JSON バックアップ・復元（スキーマ版付き）と CSV 出力（数式注入対策つき）。
import { db, STORES, SCHEMA_VERSION, getSettings, type StoreName } from './db';
import type { Settings } from '../core/types';

export interface BackupFile {
  app: 'ebay-sourcing-assistant';
  schemaVersion: number;
  exportedAt: string;
  settings: Settings;
  data: Record<StoreName, unknown[]>;
}

export async function exportBackup(): Promise<BackupFile> {
  const d = await db();
  const data = {} as Record<StoreName, unknown[]>;
  for (const s of STORES) data[s] = await d.getAll(s); // ゴミ箱内も含める
  return { app: 'ebay-sourcing-assistant', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), settings: await getSettings(), data };
}

export function validateBackup(x: unknown): { ok: true; file: BackupFile } | { ok: false; error: string } {
  const f = x as BackupFile;
  if (!f || typeof f !== 'object' || f.app !== 'ebay-sourcing-assistant') return { ok: false, error: 'このアプリのバックアップファイルではありません' };
  if (typeof f.schemaVersion !== 'number') return { ok: false, error: 'スキーマ版がありません' };
  if (f.schemaVersion > SCHEMA_VERSION) return { ok: false, error: `新しい版（${f.schemaVersion}）のバックアップです。アプリを更新してください` };
  if (!f.data || typeof f.data !== 'object') return { ok: false, error: 'データ部がありません' };
  for (const s of STORES) {
    const rows = f.data[s] ?? [];
    if (!Array.isArray(rows)) return { ok: false, error: `${s} が配列ではありません` };
    for (const r of rows) if (!r || typeof (r as { id?: unknown }).id !== 'string') return { ok: false, error: `${s} にIDのないレコードがあります` };
  }
  return { ok: true, file: f };
}

/** 現在のデータを全て置き換えて復元する（単一トランザクション） */
export async function restoreBackup(f: BackupFile) {
  const d = await db();
  const tx = d.transaction([...STORES, 'meta'], 'readwrite');
  for (const s of STORES) {
    const st = tx.objectStore(s);
    await st.clear();
    for (const r of f.data[s] ?? []) await st.put(r);
  }
  await tx.objectStore('meta').put({ ...f.settings, id: 'settings' });
  await tx.done;
}

/** 表計算ソフトでの数式注入を防ぐ */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [cols.map(csvCell).join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  return '﻿' + lines.join('\r\n'); // Excel 向け BOM
}
