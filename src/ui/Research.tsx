import { useEffect, useState } from 'preact/hooks';
import { save } from '../data/db';
import type { Product } from '../core/types';
import { useData, go, fmtDate, todayIso } from './store';
import { Header, Card, Empty, Warn, ExtLink } from './components';

// 定期リサーチの蓄積データ（リポジトリの public/research/index.json を定期タスクが更新する）
export interface ResearchSignal { date: string; kind: string; text: string; source: string; url?: string }
export interface ResearchItem {
  id: string;
  nameJa: string;
  nameEn: string;
  category: string; // ゲーム / ゲーム機 / 周辺機器 / ホビー
  platform?: string;
  why: string; // 候補にした理由（要約）
  ebayActive?: { count: number | null; priceRange: string; market: string; checkedAt: string } | null;
  domestic?: { priceRange: string; source: string; checkedAt: string } | null;
  risks: string[];
  searchTerms: string;
  firstSeen: string;
  lastSeen: string;
  seenCount: number;
  signals: ResearchSignal[];
}
export interface ResearchFile {
  schemaVersion: number;
  updatedAt: string;
  notice: string;
  runs: { date: string; themes: string[]; summary: string; report?: string }[];
  items: ResearchItem[];
}

async function loadResearch(): Promise<ResearchFile> {
  const r = await fetch('./research/index.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

export function ResearchPage() {
  const { data, reload } = useData();
  const [file, setFile] = useState<ResearchFile | null>(null);
  const [err, setErr] = useState('');
  const [cat, setCat] = useState('すべて');
  const [sort, setSort] = useState<'recent' | 'seen'>('recent');
  useEffect(() => { loadResearch().then(setFile).catch(() => setErr('リサーチデータを読み込めませんでした（オフラインの場合は前回読み込んだ内容のみ表示されます）')); }, []);

  const added = new Set(data.products.map((p) => p.note.match(/research:([\w-]+)/)?.[1]).filter(Boolean));
  const cats = ['すべて', ...new Set((file?.items ?? []).map((i) => i.category))];
  const items = (file?.items ?? [])
    .filter((i) => cat === 'すべて' || i.category === cat)
    .sort((a, b) => (sort === 'recent' ? b.lastSeen.localeCompare(a.lastSeen) : b.seenCount - a.seenCount));
  const lastRun = file?.runs.at(-1);

  return (
    <div>
      <Header title="定期リサーチ" back="more" />
      {err && <Warn>{err}</Warn>}
      {file && (
        <Card>
          <p class="small">最終更新 {fmtDate(file.updatedAt, true)} ／ 候補 {file.items.length}件 ／ 実施 {file.runs.length}回</p>
          {lastRun && <p class="small">前回：{lastRun.themes.join('、')} — {lastRun.summary}</p>}
          <small class="muted">{file.notice}</small>
        </Card>
      )}
      <div class="chips">
        {cats.map((c) => <button key={c} class={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      <div class="seg">
        <button class={sort === 'recent' ? 'on' : ''} onClick={() => setSort('recent')}>新しい順</button>
        <button class={sort === 'seen' ? 'on' : ''} onClick={() => setSort('seen')}>繰り返し出た順</button>
      </div>
      {file && items.length === 0 && <Empty>候補はまだありません</Empty>}
      {items.map((it) => (
        <details class="card research" key={it.id}>
          <summary>
            <div class="strong">{it.nameJa}</div>
            <small class="muted">{it.nameEn} ／ {it.category}{it.platform ? ' ／ ' + it.platform : ''} ／ 登場 {it.seenCount}回 ／ 最終 {fmtDate(it.lastSeen)}</small>
          </summary>
          <p>{it.why}</p>
          {it.ebayActive && <p class="small">eBay出品中：{it.ebayActive.count ?? '—'}件・{it.ebayActive.priceRange}（{it.ebayActive.market}、{fmtDate(it.ebayActive.checkedAt)}、成約ではない）</p>}
          {it.domestic && <p class="small">国内：{it.domestic.priceRange}（{it.domestic.source}、{fmtDate(it.domestic.checkedAt)}）</p>}
          {it.risks.length > 0 && <p class="small warn-line">注意：{it.risks.join('／')}</p>}
          <div class="small">
            {it.signals.slice(-5).reverse().map((s, i) => (
              <div key={i} class="hist">{fmtDate(s.date)} [{s.kind}] {s.text} <small class="muted">— {s.source}</small> {s.url && <ExtLink url={s.url} />}</div>
            ))}
          </div>
          <div class="row">
            {added.has(it.id) ? <span class="pill">台帳に追加済み</span> : (
              <button class="primary" onClick={async () => {
                const p = await save<Product>('products', {
                  nameJa: it.nameJa, nameEn: it.nameEn, maker: '', platform: it.platform ?? '', modelNumber: '', region: '', language: '',
                  edition: '', color: '', searchTerms: it.searchTerms, imageAttachmentIds: [], checkedAt: todayIso(),
                  note: `定期リサーチ候補 research:${it.id}\n理由：${it.why}`,
                });
                await reload();
                go('product/' + p.id);
              }}>台帳に追加して調べる</button>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
