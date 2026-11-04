import { useEffect, useState } from 'preact/hooks';
import { save, trash, nowIso } from '../data/db';
import { parseCode } from '../core/barcode';
import { computeStats } from '../core/stats';
import { CONDITION_LABELS, type ConditionKey, type MarketObservation, type Product, type ProductCode } from '../core/types';
import { useData, go, productName, fmtDate, todayIso } from './store';
import { Header, Card, Text, NumField, Select, Check, DateField, Empty, Warn, ExtLink, VerdictBadge } from './components';
import { evaluate, defaultDraft } from './evaluate';
import { NetLookup } from './NetLookup';

const blankProduct = (): Omit<Product, 'id' | 'createdAt' | 'updatedAt'> => ({
  nameJa: '', nameEn: '', maker: '', platform: '', modelNumber: '', region: '', language: '', edition: '', color: '',
  searchTerms: '', imageAttachmentIds: [], checkedAt: null, note: '',
});

export function ProductsPage() {
  const { data } = useData();
  const [q, setQ] = useState('');
  const list = data.products
    .filter((p) => !q || [p.nameJa, p.nameEn, p.modelNumber, p.platform, p.searchTerms].join(' ').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div>
      <Header title="商品台帳" right={<a class="btn-sm" href="#/product-new">＋追加</a>} />
      <div class="pad"><input placeholder="検索（商品名・型番・機種）" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} /></div>
      {list.length === 0 && <Empty>商品がありません。「＋追加」か「スキャン」から登録してください。</Empty>}
      {list.map((p) => {
        const nObs = data.observations.filter((o) => o.productId === p.id && o.kind === 'sold').length;
        const codes = data.codes.filter((c) => c.productId === p.id);
        return (
          <a class="row-card" href={'#/product/' + p.id} key={p.id}>
            <div class="grow">
              <div class="strong">{productName(p)}</div>
              <small class="muted">{[p.nameEn, p.platform, p.modelNumber, p.region].filter(Boolean).join(' / ')}</small>
            </div>
            <div class="right"><small>成約例 {nObs}件</small><small>コード {codes.length}</small></div>
          </a>
        );
      })}
    </div>
  );
}

export function ProductNewPage() {
  const { reload } = useData();
  const [p, setP] = useState(blankProduct());
  return (
    <div>
      <Header title="商品を追加" back="products" />
      <ProductForm p={p} onChange={setP} />
      <div class="pad">
        <button class="primary big-btn" disabled={!(p.nameJa || p.nameEn || p.modelNumber)} onClick={async () => {
          const r = await save<Product>('products', p);
          await reload();
          go('product/' + r.id);
        }}>保存</button>
      </div>
    </div>
  );
}

function ProductForm({ p, onChange }: { p: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>; onChange: (p: any) => void }) {
  const f = (k: keyof Product) => (v: string) => onChange({ ...p, [k]: v });
  return (
    <Card title="商品情報">
      <Text label="商品名（日本語）" value={p.nameJa} onInput={f('nameJa')} />
      <Text label="商品名（英語）" value={p.nameEn} onInput={f('nameEn')} />
      <div class="grid2">
        <Text label="メーカー" value={p.maker} onInput={f('maker')} />
        <Text label="機種" value={p.platform} onInput={f('platform')} />
        <Text label="型番" value={p.modelNumber} onInput={f('modelNumber')} />
        <Text label="地域（日本版等）" value={p.region} onInput={f('region')} />
        <Text label="言語" value={p.language} onInput={f('language')} />
        <Text label="版（通常/限定）" value={p.edition} onInput={f('edition')} />
        <Text label="色" value={p.color} onInput={f('color')} />
        <DateField label="確認日" value={p.checkedAt} onChange={(v) => onChange({ ...p, checkedAt: v })} />
      </div>
      <Text label="検索語（eBay検索用の英語キーワード等）" value={p.searchTerms} onInput={f('searchTerms')} />
      <Text label="メモ" value={p.note} onInput={f('note')} multiline />
      <small class="muted">箱付き/本体のみ等の個体状態は、候補・在庫側で記録します。シリアル番号は在庫個体に記録します。</small>
    </Card>
  );
}

export function ProductPage({ id }: { id: string }) {
  const { data, reload } = useData();
  const orig = data.products.find((p) => p.id === id);
  const [p, setP] = useState<Product | null>(orig ?? null);
  const [dirty, setDirty] = useState(false);
  const [cond, setCond] = useState<ConditionKey>('used_complete');
  const [editing, setEditing] = useState<MarketObservation | null>(null);
  useEffect(() => { if (orig && (!p || p.id !== orig.id)) setP(orig); }, [orig?.id]);
  if (!orig || !p) return <div><Header title="商品" back="products" /><Empty>見つかりません</Empty></div>;

  const codes = data.codes.filter((c) => c.productId === id);
  const obs = data.observations.filter((o) => o.productId === id).sort((a, b) => (b.soldAt ?? b.observedAt).localeCompare(a.soldAt ?? a.observedAt));
  const s = data.settings;
  const stats = computeStats(obs, { condition: cond, windowDays: s.researchWindowDays, staleDays: s.staleDays, minComparable: s.minComparable });
  const cands = data.candidates.filter((c) => c.productId === id);
  const ebayQ = encodeURIComponent(p.searchTerms || p.nameEn || p.nameJa);

  return (
    <div>
      <Header title={productName(p)} back="products" />
      <ProductForm p={p} onChange={(x: Product) => { setP(x); setDirty(true); }} />
      {dirty && <div class="pad"><button class="primary" onClick={async () => { await save<Product>('products', p); setDirty(false); reload(); }}>商品情報を保存</button></div>}

      <CodesCard productId={id} codes={codes} />

      <Card><NetLookup code={codes.find((c) => !c.storeName)?.normalized.replace(/^0(?=\d{12}$)/, '') ?? ''} keyword={p.searchTerms || p.nameEn || p.modelNumber || p.nameJa} productId={id} /></Card>

      <Card title="相場（成約例）" right={<button class="mini" onClick={() => setEditing(newObs(id, data.settings.defaultCurrency))}>＋成約例</button>}>
        <p class="muted small">eBay Product Research 等の公式画面で確認した内容を手入力します。自動取得はしていません。
          {ebayQ && <> 検索用：<a href={`https://www.ebay.com/sch/i.html?_nkw=${ebayQ}&LH_Sold=1&LH_Complete=1`} target="_blank" rel="noopener noreferrer">eBayの売却済み検索 ↗</a></>}</p>
        <Select label="統計の対象状態" value={cond} onChange={setCond} options={Object.entries(CONDITION_LABELS) as [ConditionKey, string][]} />
        <div class="evidence">
          <div class="strong">採用 {stats.n}件{stats.currency ? `（${stats.currency}・商品代＋送料）` : ''}</div>
          {stats.n > 0 && <div>中央値 {stats.median?.toFixed(2) ?? '—'} ／ 平均 {stats.mean?.toFixed(2) ?? '—'} ／ 範囲 {stats.min?.toFixed(2)}〜{stats.max?.toFixed(2)} ／ 最終確認 {fmtDate(stats.latestObservedAt)}</div>}
          {stats.warnings.map((w, i) => <div class="warn-line" key={i}>⚠ {w}</div>)}
          <small class="muted">自分が集めたサンプルの集計です。全体の売れ行きや、自分の商品が売れるまでの日数を示すものではありません。</small>
        </div>
        {editing && <ObsForm o={editing} onClose={() => setEditing(null)} />}
        {obs.length === 0 && <Empty>成約例はまだありません</Empty>}
        {obs.map((o) => {
          const ex = stats.excluded.find((e) => e.obs.id === o.id);
          return (
            <div class={'obs' + (ex ? ' excluded' : '')} key={o.id}>
              <div class="grow">
                <div>{o.kind === 'sold' ? '成約' : '出品中'} {o.price ?? '—'} + 送料 {o.shipping ?? '不明'} {o.currency} ／ {CONDITION_LABELS[o.condition]}{o.isLot ? ' ／ まとめ売り' : ''}</div>
                <small class="muted">販売日 {fmtDate(o.soldAt)} ／ 確認日 {fmtDate(o.observedAt)} ／ {o.source}{o.region && ' ／ ' + o.region} {ex && <b>／ 除外：{ex.reason}</b>}</small>
                <ExtLink url={o.url} />
              </div>
              <button class="mini" onClick={() => setEditing(o)}>編集</button>
            </div>
          );
        })}
      </Card>

      <Card title={`仕入れ候補（${cands.length}）`} right={<button class="mini" onClick={async () => {
        const c = await save<any>('candidates', { productId: id, storeOrSite: '', url: '', price: null, priceKind: 'fixed', domesticShipping: null, condition: 'unknown', conditionNote: '', checklistCategory: '', checks: {}, hardBlocker: '', productConfirmed: false, status: 'open', draft: null, note: '' });
        await reload(); go('candidate/' + c.id);
      }}>＋候補</button>}>
        {cands.length === 0 && <Empty>なし</Empty>}
        {cands.map((c) => {
          const ev = evaluate(c, c.draft ?? defaultDraft(c, data.settings, data.feeProfiles), data);
          return (
            <a class="row-card flat" href={'#/candidate/' + c.id} key={c.id}>
              <div class="grow">{c.storeOrSite || '店舗未入力'} ／ {c.price ? '¥' + Number(c.price).toLocaleString() : '価格未入力'}</div>
              <VerdictBadge v={ev.judge.verdict} />
            </a>
          );
        })}
      </Card>

      <div class="pad"><button class="danger ghost" onClick={async () => { await trash('products', id); await reload(); go('products'); }}>この商品をゴミ箱へ</button></div>
    </div>
  );
}

function CodesCard({ productId, codes }: { productId: string; codes: ProductCode[] }) {
  const { data, reload } = useData();
  const [raw, setRaw] = useState('');
  const [store, setStore] = useState('');
  const parsed = raw.trim() ? parseCode(raw.trim()) : null;
  const dup = parsed ? data.codes.filter((c) => c.normalized === parsed.normalized && c.productId !== productId) : [];
  return (
    <Card title="バーコード">
      {codes.length === 0 && <Empty>未登録</Empty>}
      {codes.map((c) => (
        <div class="obs" key={c.id}>
          <div class="grow"><span class="mono">{c.raw}</span> <small class="muted">（{c.codeType}{c.storeName ? '・店舗：' + c.storeName : ''}）</small></div>
          <button class="mini ghost" onClick={async () => { await trash('productCodes', c.id); reload(); }}>削除</button>
        </div>
      ))}
      <div class="sub">
        <input inputMode="numeric" placeholder="コードを追加" value={raw} onInput={(e) => setRaw((e.target as HTMLInputElement).value)} />
        {parsed && <small class="muted">種別 {parsed.type} ／ チェックデジット {parsed.checkDigitValid === null ? '対象外' : parsed.checkDigitValid ? '正常' : '不一致'}</small>}
        {parsed?.storeInternal && <Text label="店名（店舗独自コード）" value={store} onInput={setStore} />}
        {dup.length > 0 && <Warn>このコードは別の商品にも登録されています（スキャン時は選択画面になります）。</Warn>}
        <button disabled={!parsed || (parsed.storeInternal && !store)} onClick={async () => {
          await save<ProductCode>('productCodes', { productId, raw: parsed!.raw, normalized: parsed!.normalized, codeType: parsed!.type, storeName: store, status: 'confirmed' });
          setRaw(''); setStore(''); reload();
        }}>追加</button>
      </div>
    </Card>
  );
}

function newObs(productId: string, currency: string): MarketObservation {
  const t = nowIso();
  return {
    id: '', createdAt: t, updatedAt: t, productId, condition: 'used_complete', kind: 'sold', url: '', source: 'eBay Product Research',
    observedAt: todayIso(), soldAt: null, currency, price: null, shipping: null, region: '', accessories: '', isLot: false, adopted: true, excludeReason: '', note: '',
  };
}

function ObsForm({ o: init, onClose }: { o: MarketObservation; onClose: () => void }) {
  const { reload } = useData();
  const [o, setO] = useState(init);
  const u = (patch: Partial<MarketObservation>) => setO({ ...o, ...patch });
  return (
    <div class="sub boxed">
      <Select label="区分" value={o.kind} onChange={(v) => u({ kind: v as any })} options={[['sold', '成約（売れた）'], ['listing', '出品中（参考）']]} />
      <Select label="状態" value={o.condition} onChange={(v) => u({ condition: v })} options={Object.entries(CONDITION_LABELS) as [ConditionKey, string][]} />
      <div class="grid2">
        <NumField label="商品代" value={o.price} onChange={(v) => u({ price: v })} unit={o.currency} />
        <NumField label="送料（不明なら空欄）" value={o.shipping} onChange={(v) => u({ shipping: v })} unit={o.currency} />
        <Text label="通貨" value={o.currency} onInput={(v) => u({ currency: v.toUpperCase() })} />
        <Text label="地域" value={o.region} onInput={(v) => u({ region: v })} />
        <DateField label="販売日" value={o.soldAt} onChange={(v) => u({ soldAt: v })} />
        <DateField label="確認日" value={o.observedAt} onChange={(v) => u({ observedAt: v ?? todayIso() })} />
      </div>
      <Text label="出典" value={o.source} onInput={(v) => u({ source: v })} />
      <Text label="URL" value={o.url} onInput={(v) => u({ url: v })} type="url" />
      <Text label="付属品" value={o.accessories} onInput={(v) => u({ accessories: v })} />
      <Check label="まとめ売り" checked={o.isLot} onChange={(v) => u({ isLot: v })} />
      <Check label="統計に採用する" checked={o.adopted} onChange={(v) => u({ adopted: v })} />
      {!o.adopted && <Text label="除外理由" value={o.excludeReason} onInput={(v) => u({ excludeReason: v })} placeholder="例：別地域版、欠品あり" />}
      <Text label="メモ" value={o.note} onInput={(v) => u({ note: v })} />
      <div class="row">
        <button class="primary" disabled={!o.price} onClick={async () => {
          const { id, ...rest } = o;
          await save<MarketObservation>('observations', id ? o : rest);
          await reload(); onClose();
        }}>保存</button>
        <button onClick={onClose}>キャンセル</button>
        {o.id && <button class="danger ghost" onClick={async () => { await trash('observations', o.id); await reload(); onClose(); }}>削除</button>}
      </div>
    </div>
  );
}
