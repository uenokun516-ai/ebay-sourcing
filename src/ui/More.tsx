import { useEffect, useState } from 'preact/hooks';
import { save, saveSettings, trash, untrash, purge, listAll, STORES, nowIso, type StoreName } from '../data/db';
import { exportBackup, validateBackup, restoreBackup, toCsv } from '../data/backup';
import type { FeeProfile, FxRate, Settings, ShippingQuote, Base, Product, ProductCode, MarketObservation, SourcingCandidate } from '../core/types';
import { useData, go, fmtDate, todayIso, isoToDateInput } from './store';
import { Header, Card, Text, NumField, Select, Check, DateField, Empty, Warn, download } from './components';
import { callWorker } from '../core/lookup';

export function MorePage() {
  const { data } = useData();
  const last = data.settings.lastBackupAt;
  const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
  const items: [string, string, string][] = [
    ['research', '定期リサーチ（売れ筋候補）', '蓄積データ'],
    ['records', '取り込みデータ（出品・成約・入札・話題）', `${data.records.length}件`],
    ['sources', '接続状態・データ取得検証表', ''],
    ['requests', '探し物リクエスト', `${data.requests.length}件`],
    ['settings', '設定（目標・慎重シナリオ等）', data.settings.targetM ? `目標 ¥${Number(data.settings.targetM).toLocaleString()}` : '目標未設定'],
    ['fees', '手数料プロファイル', `${data.feeProfiles.length}件`],
    ['shipping', '送料見積', `${data.shippingQuotes.length}件`],
    ['fx', '為替レート', `${data.fxRates.length}件`],
    ['backup', 'バックアップ・復元・CSV', last ? `最終 ${fmtDate(last)}` : '未実施'],
    ['trash', 'ゴミ箱', ''],
    ['about', 'このアプリについて・制限', ''],
  ];
  return (
    <div>
      <Header title="その他" />
      {(days === null || days > 7) && <Warn>データはこの端末のブラウザ内だけに保存されています。ブラウザのデータ削除で消えるため、定期的にバックアップしてください（{days === null ? '未実施' : `${days}日前`}）。</Warn>}
      <div class="menu">
        {items.map(([k, l, s]) => <a href={'#/' + k} key={k}><span>{l}</span><small>{s} ›</small></a>)}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { data, reload } = useData();
  const [s, setS] = useState<Settings>(data.settings);
  const [msg, setMsg] = useState('');
  useEffect(() => setS(data.settings), [data.settings.version]);
  const u = (p: Partial<Settings>) => setS({ ...s, ...p });
  const uc = (p: Partial<Settings['cautious']>) => setS({ ...s, cautious: { ...s.cautious, ...p } });
  return (
    <div>
      <Header title="設定" back="more" />
      <Card title="目標と上限（本人が入力）">
        <NumField label="目標残額 M（1点あたり）" value={s.targetM} onChange={(v) => u({ targetM: v })} unit="円" hint="未設定のあいだは計算だけ表示し、仕入れ推奨は出しません" />
        <NumField label="1点あたりの仕入れ上限" value={s.maxPerItemJPY} onChange={(v) => u({ maxPerItemJPY: v })} unit="円" />
        <NumField label="時給（作業代控除後の表示用・任意）" value={s.hourlyWage} onChange={(v) => u({ hourlyWage: v })} unit="円" />
      </Card>
      <Card title="為替の扱い">
        <Text label="既定の販売通貨" value={s.defaultCurrency} onInput={(v) => u({ defaultCurrency: v.toUpperCase() })} />
        <Select label="為替費用" value={s.fxMode} onChange={(v) => u({ fxMode: v })} options={[['inRate', 'レートに織り込む（実際の受取レートを入力）'], ['separate', '別計上する（市場レート＋費用率）']]} />
        {s.fxMode === 'separate' && <NumField label="為替費用率" value={s.fxCostPct} onChange={(v) => u({ fxCostPct: v })} unit="%" />}
        <small class="muted">どちらか一方だけが適用され、二重に差し引かれることはありません。</small>
      </Card>
      <Card title="慎重シナリオ（仮設定・編集可）">
        <NumField label="売価の下落率" value={s.cautious.priceDropPct} onChange={(v) => uc({ priceDropPct: v })} unit="%" />
        <NumField label="円高幅（レートを下げる率）" value={s.cautious.yenStrongPct} onChange={(v) => uc({ yenStrongPct: v })} unit="%" />
        <NumField label="国際送料の増額率" value={s.cautious.shippingIncreasePct} onChange={(v) => uc({ shippingIncreasePct: v })} unit="%" />
        <small class="muted">市場予測ではなく、条件が悪かった場合の確認用です。</small>
      </Card>
      <Card title="相場の扱い（仮設定）">
        <NumField label="成約調査期間" value={String(s.researchWindowDays)} onChange={(v) => u({ researchWindowDays: Number(v) || 90 })} unit="日" />
        <NumField label="相場の再確認目安" value={String(s.staleDays)} onChange={(v) => u({ staleDays: Number(v) || 30 })} unit="日" />
        <NumField label="少数表示の基準（未満で少数）" value={String(s.minComparable)} onChange={(v) => u({ minComparable: Number(v) || 5 })} unit="件" />
        <small class="muted">需要や利益を保証する閾値ではありません。</small>
      </Card>
      <Card title="ネット検索（中継サーバー）">
        <Text label="中継サーバーのURL" value={s.workerUrl} onInput={(v) => u({ workerUrl: v.trim() })} placeholder="https://xxxx.workers.dev" type="url" />
        <Text label="合言葉（APP_KEY）" value={s.appKey} onInput={(v) => u({ appKey: v.trim() })} />
        <Select label="eBay の検索先" value={s.ebayMarket} onChange={(v) => u({ ebayMarket: v })}
          options={[['EBAY_US', 'アメリカ（ebay.com）'], ['EBAY_GB', 'イギリス'], ['EBAY_DE', 'ドイツ'], ['EBAY_AU', 'オーストラリア'], ['EBAY_CA', 'カナダ']]} />
        <button class="mini" disabled={!s.workerUrl} onClick={async () => {
          try {
            const h = await callWorker<{ ok: boolean; yahoo: boolean; ebay: boolean }>(s.workerUrl, s.appKey, 'health', {});
            setMsg(`接続OK：Yahoo! ${h.yahoo ? '設定済み' : '未設定'} ／ eBay ${h.ebay ? '設定済み' : '未設定'}（保存を押して確定）`);
          } catch (e) { setMsg('接続できません：' + (e as Error).message); }
        }}>接続テスト</button>
        <small class="muted">APIキー自体は中継サーバー側に保存し、このアプリやバックアップには入りません。合言葉はバックアップに含まれます。</small>
      </Card>
      <div class="pad">
        {msg && <p class="ok">{msg}</p>}
        <button class="primary big-btn" onClick={async () => { await saveSettings(s); await reload(); setMsg('保存しました（設定版が更新されました）'); }}>保存（現在 v{data.settings.version}）</button>
      </div>
    </div>
  );
}

function blankFee(): Omit<FeeProfile, 'id' | 'createdAt' | 'updatedAt'> {
  return { name: '', ratePct: null, fixedPerOrder: null, currency: 'USD', baseIncludesShipping: true, baseIncludesTax: true, isEstimate: true, source: '', checkedAt: todayIso(), version: 1 };
}

export function FeesPage() {
  const { data, reload } = useData();
  const [ed, setEd] = useState<any | null>(null);
  return (
    <div>
      <Header title="手数料プロファイル" back="more" right={<button class="btn-sm" onClick={() => setEd(blankFee())}>＋追加</button>} />
      <div class="pad"><small class="muted">料率はカテゴリー・ストア契約・時期で変わります。自分の条件を eBay の公式ページで確認し、確認日と出典を記録してください。料率の初期値は入れていません。</small></div>
      {ed && (
        <Card title={ed.id ? '編集（保存で版が上がります）' : '新規'}>
          <Text label="名前" value={ed.name} onInput={(v) => setEd({ ...ed, name: v })} placeholder="例：ゲーム機カテゴリー（ストアなし）" />
          <NumField label="料率" value={ed.ratePct} onChange={(v) => setEd({ ...ed, ratePct: v })} unit="%" />
          <NumField label="1注文あたり固定額" value={ed.fixedPerOrder} onChange={(v) => setEd({ ...ed, fixedPerOrder: v })} unit={ed.currency} />
          <Text label="固定額の通貨" value={ed.currency} onInput={(v) => setEd({ ...ed, currency: v.toUpperCase() })} />
          <Check label="買い手負担送料も課金対象" checked={ed.baseIncludesShipping} onChange={(v) => setEd({ ...ed, baseIncludesShipping: v })} />
          <Check label="買い手徴収税も課金対象" checked={ed.baseIncludesTax} onChange={(v) => setEd({ ...ed, baseIncludesTax: v })} />
          <Check label="概算（未確認）として扱う" checked={ed.isEstimate} onChange={(v) => setEd({ ...ed, isEstimate: v })} />
          <Text label="出典URL・メモ" value={ed.source} onInput={(v) => setEd({ ...ed, source: v })} />
          <DateField label="確認日" value={ed.checkedAt} onChange={(v) => setEd({ ...ed, checkedAt: v })} />
          <div class="row">
            <button class="primary" disabled={!ed.name} onClick={async () => { await save<FeeProfile>('feeProfiles', ed.id ? { ...ed, version: ed.version + 1 } : ed); setEd(null); reload(); }}>保存</button>
            <button onClick={() => setEd(null)}>キャンセル</button>
          </div>
        </Card>
      )}
      {data.feeProfiles.length === 0 && !ed && <Empty>未登録（候補画面では手入力の概算で計算できます）</Empty>}
      {data.feeProfiles.map((f) => (
        <div class="row-card" key={f.id}>
          <div class="grow">
            <div class="strong">{f.name} <small>v{f.version}</small></div>
            <small class="muted">{f.ratePct}% ＋ {f.fixedPerOrder} {f.currency} ／ 送料{f.baseIncludesShipping ? '含む' : '含まない'}・税{f.baseIncludesTax ? '含む' : '含まない'} ／ {f.isEstimate ? '概算' : '確認済'} ／ 確認日 {fmtDate(f.checkedAt)}</small>
          </div>
          <button class="mini" onClick={() => setEd(f)}>編集</button>
          <button class="mini ghost" onClick={async () => { await trash('feeProfiles', f.id); reload(); }}>削除</button>
        </div>
      ))}
    </div>
  );
}

export function ShippingPage() {
  const { data, reload } = useData();
  const [ed, setEd] = useState<any | null>(null);
  const blank = { name: '', destination: '', method: '', weightG: null, sizeNote: '', amountJPY: null, shippable: 'unknown', source: '', checkedAt: todayIso(), isEstimate: true };
  return (
    <div>
      <Header title="送料見積" back="more" right={<button class="btn-sm" onClick={() => setEd(blank)}>＋追加</button>} />
      <div class="pad"><small class="muted">配送先・方法・梱包後の重量とサイズごとに登録します。世界一律の送料として扱いません。電池を含む商品は宛先・運送会社ごとに輸送条件を確認してください。</small></div>
      {ed && (
        <Card title={ed.id ? '編集' : '新規'}>
          <Text label="名前" value={ed.name} onInput={(v) => setEd({ ...ed, name: v })} placeholder="例：米国・小型 1kgまで" />
          <Text label="配送先" value={ed.destination} onInput={(v) => setEd({ ...ed, destination: v })} />
          <Text label="配送方法" value={ed.method} onInput={(v) => setEd({ ...ed, method: v })} />
          <NumField label="梱包後重量" value={ed.weightG} onChange={(v) => setEd({ ...ed, weightG: v })} unit="g" />
          <Text label="梱包後サイズ" value={ed.sizeNote} onInput={(v) => setEd({ ...ed, sizeNote: v })} />
          <NumField label="送料" value={ed.amountJPY} onChange={(v) => setEd({ ...ed, amountJPY: v })} unit="円" />
          <Select label="輸送可否" value={ed.shippable} onChange={(v) => setEd({ ...ed, shippable: v })} options={[['unknown', '未確認'], ['yes', '可'], ['no', '不可']]} />
          <Check label="概算" checked={ed.isEstimate} onChange={(v) => setEd({ ...ed, isEstimate: v })} />
          <Text label="出典" value={ed.source} onInput={(v) => setEd({ ...ed, source: v })} />
          <DateField label="確認日" value={ed.checkedAt} onChange={(v) => setEd({ ...ed, checkedAt: v })} />
          <div class="row">
            <button class="primary" disabled={!ed.name} onClick={async () => { await save<ShippingQuote>('shippingQuotes', ed); setEd(null); reload(); }}>保存</button>
            <button onClick={() => setEd(null)}>キャンセル</button>
          </div>
        </Card>
      )}
      {data.shippingQuotes.length === 0 && !ed && <Empty>未登録</Empty>}
      {data.shippingQuotes.map((q) => (
        <div class="row-card" key={q.id}>
          <div class="grow">
            <div class="strong">{q.name}</div>
            <small class="muted">{q.destination} ／ {q.method} ／ {q.weightG ?? '?'}g ／ {q.amountJPY ?? '未入力'}円 ／ {{ yes: '可', no: '不可', unknown: '可否未確認' }[q.shippable]} ／ 確認日 {fmtDate(q.checkedAt)}</small>
          </div>
          <button class="mini" onClick={() => setEd(q)}>編集</button>
          <button class="mini ghost" onClick={async () => { await trash('shippingQuotes', q.id); reload(); }}>削除</button>
        </div>
      ))}
    </div>
  );
}

export function FxPage() {
  const { data, reload } = useData();
  const [cur, setCur] = useState('USD');
  const [rate, setRate] = useState<string | null>(null);
  const [src, setSrc] = useState('');
  const [d, setD] = useState<string | null>(todayIso());
  return (
    <div>
      <Header title="為替レート" back="more" />
      <Card title="追加（手入力）">
        <Text label="通貨" value={cur} onInput={(v) => setCur(v.toUpperCase())} />
        <NumField label="1外貨＝何円" value={rate} onChange={setRate} unit="円" />
        <Text label="出典" value={src} onInput={setSrc} placeholder="例：eBay受取レート、銀行の公表値" />
        <DateField label="確認日" value={d} onChange={setD} />
        <button class="primary" disabled={!rate} onClick={async () => { await save<FxRate>('fxRates', { currency: cur, rateJPY: rate, source: src, checkedAt: d }); setRate(null); reload(); }}>追加</button>
      </Card>
      {data.fxRates.map((r) => (
        <div class="row-card" key={r.id}>
          <div class="grow"><b>{r.currency}</b> {r.rateJPY}円 <small class="muted">／ {r.source} ／ 確認日 {fmtDate(r.checkedAt)}</small></div>
          <button class="mini ghost" onClick={async () => { await trash('fxRates', r.id); reload(); }}>削除</button>
        </div>
      ))}
    </div>
  );
}

const CSV_SETS: [StoreName, string][] = [
  ['sourceRecords', '取り込みデータ'],
  ['products', '商品'], ['observations', '成約例'], ['candidates', '仕入れ候補'], ['estimates', '見積もり'], ['inventory', '在庫'], ['saleEvents', '在庫イベント'], ['requests', 'リクエスト'],
];

export function BackupPage() {
  const { data, reload } = useData();
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => { navigator.storage?.persisted?.().then(setPersisted).catch(() => {}); }, []);
  return (
    <div>
      <Header title="バックアップ・復元" back="more" />
      <Card title="バックアップ（JSON）">
        <p>最終バックアップ：{fmtDate(data.settings.lastBackupAt, true)}</p>
        <p class="muted small">商品・コード・候補・成約例・見積もり・在庫・添付・設定をすべて含みます（ゴミ箱内も含む）。APIキー等は含みません。</p>
        <button class="primary big-btn" onClick={async () => {
          const b = await exportBackup();
          const stamp = isoToDateInput(nowIso()).replace(/-/g, '') + '-' + new Date().toTimeString().slice(0, 5).replace(':', '');
          download(`ebay-sourcing-backup-${stamp}.json`, JSON.stringify(b, null, 1), 'application/json');
          await saveSettings({ ...data.settings, lastBackupAt: nowIso() }, false);
          reload(); setMsg('バックアップを書き出しました');
        }}>バックアップを書き出す</button>
        {msg && <p class="ok">{msg}</p>}
      </Card>
      <Card title="復元">
        <Warn>復元すると、この端末の現在のデータはバックアップの内容で置き換わります。先に現在のデータを書き出しておくと安全です。</Warn>
        <input type="file" accept="application/json,.json" onChange={async (e) => {
          setErr(''); setMsg('');
          const f = (e.target as HTMLInputElement).files?.[0];
          if (!f) return;
          try {
            const v = validateBackup(JSON.parse(await f.text()));
            if (!v.ok) { setErr(v.error); return; }
            const n = STORES.reduce((s, k) => s + (v.file.data[k]?.length ?? 0), 0);
            if (!confirm(`${fmtDate(v.file.exportedAt, true)} のバックアップ（${n}件）で置き換えます。よろしいですか？`)) return;
            await restoreBackup(v.file);
            await reload(); setMsg('復元しました');
          } catch (x) { setErr('読み込めませんでした：' + String(x)); }
          (e.target as HTMLInputElement).value = '';
        }} />
        {err && <Warn>{err}</Warn>}
      </Card>
      <Card title="CSV出力">
        <p class="muted small">表計算ソフト向け。数式として解釈される文字（= + - @ 等）で始まる値は無害化しています。</p>
        <div class="row wrap">
          {CSV_SETS.map(([k, l]) => (
            <button key={k} class="mini" onClick={async () => {
              const rows = (await listAll<Base>(k)) as unknown as Record<string, unknown>[];
              download(`${k}.csv`, toCsv(rows), 'text/csv');
            }}>{l}</button>
          ))}
        </div>
      </Card>
      <Card title="保存の状態">
        <p>永続保存：{persisted === null ? '不明' : persisted ? '許可済み（自動削除されにくい）' : '未許可'}</p>
        {navigator.storage?.persist && !persisted && <button class="mini" onClick={async () => setPersisted(await navigator.storage.persist())}>永続保存を要求する</button>}
        <p class="muted small">スマホとPCの自動同期はありません。端末を移すときはバックアップを書き出し、移動先で復元してください。</p>
      </Card>
    </div>
  );
}

const TRASH_LABELS: Partial<Record<StoreName, string>> = {
  products: '商品', productCodes: 'コード', observations: '成約例', candidates: '候補', feeProfiles: '手数料', shippingQuotes: '送料',
  fxRates: '為替', estimates: '見積もり', sourceRecords: '取り込みデータ', requests: 'リクエスト', inventory: '在庫', saleEvents: '在庫イベント', attachments: '添付',
};

export function TrashPage() {
  const { reload } = useData();
  const [rows, setRows] = useState<{ store: StoreName; r: any }[]>([]);
  const load = async () => {
    const out: { store: StoreName; r: any }[] = [];
    for (const s of STORES) for (const r of await listAll<Base>(s, true)) if (r.deletedAt) out.push({ store: s, r });
    setRows(out.sort((a, b) => b.r.deletedAt.localeCompare(a.r.deletedAt)));
  };
  useEffect(() => { load(); }, []);
  return (
    <div>
      <Header title="ゴミ箱" back="more" />
      {rows.length === 0 && <Empty>空です</Empty>}
      {rows.map(({ store, r }) => (
        <div class="row-card" key={store + r.id}>
          <div class="grow">
            <b>{TRASH_LABELS[store]}</b> {r.nameJa || r.nameEn || r.name || r.storeOrSite || r.wantedItem || r.raw || r.price || r.id.slice(0, 8)}
            <div><small class="muted">削除 {fmtDate(r.deletedAt, true)}</small></div>
          </div>
          <button class="mini" onClick={async () => { await untrash(store, r.id); await load(); reload(); }}>戻す</button>
          <button class="mini danger ghost" onClick={async () => { if (confirm('完全に削除します。元に戻せません。')) { await purge(store, r.id); await load(); } }}>完全削除</button>
        </div>
      ))}
    </div>
  );
}

export function AboutPage() {
  const { data, reload } = useData();
  const hasDemo = data.products.some((p) => p.isDemo);
  return (
    <div>
      <Header title="このアプリについて" back="more" />
      <Card title="できること（Phase 1）">
        <ul>
          <li>商品台帳・バーコード登録、スキャン→登録済み商品の候補表示→本人確認</li>
          <li>成約例の手動登録と、同条件のみの統計（少数・重複・外れ値・送料不明・古さを表示）</li>
          <li>予想残額・仕入れ上限・標準/慎重シナリオ・判定理由（決まった計算式で計算）</li>
          <li>在庫・検品・売却・返品返金の記録と、予想/実績の別表示</li>
          <li>探し物リクエストの手入力管理（文案は保存のみ）</li>
          <li>JSONバックアップ・復元、CSV出力、ゴミ箱</li>
        </ul>
      </Card>
      <Card title="しないこと・制限">
        <ul>
          <li>相場の自動取得、サイト巡回、自動購入・入札・出品・送信、外部決済はしません</li>
          <li>AI連携はありません（Phase 2）。成約価格・販売件数・純正判定・動作保証を推測で埋めません</li>
          <li>データはこの端末のブラウザ内のみ。スマホとPCの同期はありません</li>
          <li>カメラはHTTPSのページでのみ動作します</li>
          <li>判定は利益を保証しません。古物商許可など法令面の確認は別途行ってください</li>
        </ul>
      </Card>
      <Card title="デモデータ">
        <p class="muted small">動作確認用の架空商品です。実在商品の相場や収益性を示すものではありません。名前に【架空デモ】が付きます。</p>
        {!hasDemo ? <button onClick={async () => { await addDemo(); reload(); go('products'); }}>架空デモ商品を追加</button>
          : <button class="danger ghost" onClick={async () => { for (const p of data.products.filter((x) => x.isDemo)) await trash('products', p.id); reload(); }}>デモ商品をゴミ箱へ</button>}
      </Card>
    </div>
  );
}

async function addDemo() {
  const p = await save<Product>('products', {
    nameJa: 'サンプル携帯ゲーム機', nameEn: 'Sample Handheld Console (fictional)', maker: '架空メーカー', platform: 'デモ機', modelNumber: 'DEMO-001',
    region: '日本版', language: '日本語', edition: '通常版', color: '白', searchTerms: 'sample handheld demo', imageAttachmentIds: [], checkedAt: todayIso(), note: '架空のデモ商品', isDemo: true,
  });
  await save<ProductCode>('productCodes', { productId: p.id, raw: '4900000000009', normalized: '4900000000009', codeType: 'EAN-13', storeName: '', status: 'confirmed' });
  const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
  const prices = [['40', '10'], ['42', '12'], ['38', '10'], ['45', null]];
  for (const [i, [pr, sh]] of prices.entries()) {
    await save<MarketObservation>('observations', {
      productId: p.id, condition: 'used_complete', kind: 'sold', url: '', source: '架空デモデータ', observedAt: day(2), soldAt: day(10 + i * 7),
      currency: 'USD', price: pr, shipping: sh, region: '', accessories: '箱・説明書', isLot: false, adopted: true, excludeReason: '', note: '架空',
    });
  }
  await save<SourcingCandidate>('candidates', {
    productId: p.id, storeOrSite: '架空リサイクル店', url: '', price: '3000', priceKind: 'store', domesticShipping: '0', condition: 'used_complete',
    conditionNote: '', checklistCategory: 'ゲーム機', checks: {}, hardBlocker: '', productConfirmed: true, status: 'open', draft: null, note: '架空',
  });
}
