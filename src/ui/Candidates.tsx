import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import Decimal from 'decimal.js';
import { save, trash, nowIso, listAll } from '../data/db';
import { yen, LABELS, toDec, type EstimateInput, type Num } from '../core/money';
import {
  CHECKLISTS, CONDITION_LABELS, PRICE_KIND_LABELS, type ConditionKey, type EstimateDraft, type EstimateSnapshot,
  type InventoryItem, type PriceKind, type SaleEvent, type SourcingCandidate,
} from '../core/types';
import { useData, go, productName, fmtDate } from './store';
import { Header, Card, Text, NumField, Select, Check, VerdictBadge, Empty, Warn, ExtLink } from './components';
import { defaultDraft, evaluate, feeFromProfile, type Evaluation } from './evaluate';

export function CandidatesPage() {
  const { data } = useData();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const list = data.candidates
    .filter((c) => filter === 'all' || c.status === 'open')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div>
      <Header title="仕入れ候補" right={<a class="btn-sm" href="#/candidate-new">＋追加</a>} />
      <div class="seg">
        <button class={filter === 'open' ? 'on' : ''} onClick={() => setFilter('open')}>検討中</button>
        <button class={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>すべて</button>
      </div>
      {list.length === 0 && <Empty>候補はまだありません。「スキャン」から読み取るか、＋追加から登録してください。</Empty>}
      {list.map((c) => <CandidateRow key={c.id} c={c} />)}
    </div>
  );
}

function CandidateRow({ c }: { c: SourcingCandidate }) {
  const { data } = useData();
  const p = data.products.find((x) => x.id === c.productId);
  const ev = evaluate(c, c.draft ?? defaultDraft(c, data.settings, data.feeProfiles), data);
  return (
    <a class="row-card" href={'#/candidate/' + c.id}>
      <div class="grow">
        <div class="strong">{productName(p)}</div>
        <small class="muted">{c.storeOrSite || '店舗未入力'} ／ {c.price ? '¥' + Number(c.price).toLocaleString() : '価格未入力'} ／ {CONDITION_LABELS[c.condition]}
          {c.status !== 'open' && ` ／ ${c.status === 'bought' ? '購入済' : '見送り'}`}</small>
      </div>
      <div class="right">
        <VerdictBadge v={ev.judge.verdict} />
        <small>{ev.std.E ? '残額 ' + yen(ev.std.E) : ''}</small>
      </div>
    </a>
  );
}

export function NewCandidatePage() {
  const { data, reload } = useData();
  const [pid, setPid] = useState('');
  const [q, setQ] = useState('');
  const hits = data.products.filter((p) => !q || [p.nameJa, p.nameEn, p.modelNumber].join(' ').toLowerCase().includes(q.toLowerCase())).slice(0, 30);
  return (
    <div>
      <Header title="候補を追加" back="candidates" />
      <Card title="商品を選ぶ">
        {data.products.length === 0 && <Empty>先に「商品」タブで商品を登録してください。</Empty>}
        <input placeholder="商品名・型番で絞り込み" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        {hits.map((p) => (
          <label class="pick" key={p.id}>
            <span>{productName(p)} <small class="muted">{p.modelNumber}</small></span>
            <input type="radio" name="p" checked={pid === p.id} onChange={() => setPid(p.id)} />
          </label>
        ))}
        <button class="primary" disabled={!pid} onClick={async () => {
          const c = await save<SourcingCandidate>('candidates', {
            productId: pid, storeOrSite: '', url: '', price: null, priceKind: 'fixed', domesticShipping: null, condition: 'unknown',
            conditionNote: '', checklistCategory: '', checks: {}, hardBlocker: '', productConfirmed: false, status: 'open', draft: null, note: '',
          });
          await reload();
          go('candidate/' + c.id);
        }}>作成</button>
      </Card>
    </div>
  );
}

export function CandidatePage({ id }: { id: string }) {
  const { data, reload } = useData();
  const orig = data.candidates.find((c) => c.id === id);
  const [c, setC] = useState<SourcingCandidate | null>(orig ?? null);
  const [draft, setDraft] = useState<EstimateDraft | null>(null);
  const [savedMsg, setSavedMsg] = useState('');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (orig && (!c || c.id !== orig.id)) setC(orig);
    if (orig && !draft) setDraft(orig.draft ?? defaultDraft(orig, data.settings, data.feeProfiles));
  }, [orig?.id]);

  // 入力途中の内容は自動保存
  useEffect(() => {
    if (!c || !draft || !orig) return;
    const strip = (x: object) => JSON.stringify({ ...x, updatedAt: '' });
    if (strip({ ...c, draft }) === strip({ ...orig, draft: orig.draft ?? draft })) return;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      await save<SourcingCandidate>('candidates', { ...c, draft });
      reload();
    }, 600);
    return () => clearTimeout(timer.current);
  }, [c, draft]);

  const ev = useMemo(() => (c && draft ? evaluate(c, draft, data) : null), [c, draft, data]);
  if (!orig) return <div><Header title="候補" back="candidates" /><Empty>見つかりません（ゴミ箱に移動した可能性があります）</Empty></div>;
  if (!c || !draft || !ev) return null;

  const p = data.products.find((x) => x.id === c.productId);
  const upd = (patch: Partial<SourcingCandidate>) => setC({ ...c, ...patch });
  const updIn = (patch: Partial<EstimateInput>) => setDraft({ ...draft, input: { ...draft.input, ...patch } });
  const snaps = data.estimates.filter((e) => e.candidateId === c.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const saveSnapshot = async () => {
    const fp = draft.feeProfileId ? data.feeProfiles.find((f) => f.id === draft.feeProfileId) ?? null : null;
    await save<EstimateSnapshot>('estimates', {
      productId: c.productId, candidateId: c.id, input: ev.input, cautious: data.settings.cautious, targetM: data.settings.targetM,
      destination: draft.destination, shippable: draft.shippable, settingsVersion: data.settings.version, feeProfileSnapshot: fp,
      evidenceObservationIds: ev.stats.used.map((o) => o.id),
      evidenceSummary: `成約${ev.stats.n}件／中央値 ${ev.stats.median?.toFixed(2) ?? '—'} ${ev.stats.currency ?? ''}／最終確認 ${fmtDate(ev.stats.latestObservedAt)}`,
      standardE: ev.std.E?.toString() ?? null, cautiousE: ev.cau.E?.toString() ?? null, cmax: ev.cmax?.toString() ?? null,
      verdict: ev.judge.verdict, reasons: ev.judge.reasons, missing: ev.std.missing,
    });
    await reload();
    setSavedMsg('見積もりを保存しました（相場を更新しても、この時点の根拠は残ります）');
    setTimeout(() => setSavedMsg(''), 4000);
  };

  return (
    <div>
      <Header title={productName(p)} back="candidates" />
      <VerdictCard ev={ev} />

      <Card title="仕入れ候補">
        <Check label="実物・出品内容がこの商品と一致することを確認した" checked={c.productConfirmed} onChange={(v) => upd({ productConfirmed: v })} />
        {p && <small class="muted">商品：<a href={'#/product/' + p.id}>{[p.nameEn, p.platform, p.modelNumber, p.region, p.edition].filter(Boolean).join(' / ') || '詳細を開く'}</a></small>}
        <Text label="店名・サイト" value={c.storeOrSite} onInput={(v) => upd({ storeOrSite: v })} />
        <Text label="URL（登録してもページの中身は読み込みません）" value={c.url} onInput={(v) => upd({ url: v })} type="url" />
        <ExtLink url={c.url} />
        <NumField label="仕入れ値 C" value={c.price} onChange={(v) => upd({ price: v })} unit="円" big />
        <Select label="価格の種類" value={c.priceKind} onChange={(v) => upd({ priceKind: v as PriceKind })} options={Object.entries(PRICE_KIND_LABELS) as [PriceKind, string][]} />
        {c.priceKind === 'current_bid' && <Warn>現在入札額は最終支払額ではありません。落札時の支払総額（送料・手数料込み）で再計算してください。</Warn>}
        <NumField label="国内送料 D" value={c.domesticShipping} onChange={(v) => upd({ domesticShipping: v })} unit="円" />
        <Select label="状態" value={c.condition} onChange={(v) => upd({ condition: v as ConditionKey })} options={Object.entries(CONDITION_LABELS) as [ConditionKey, string][]} />
        <Text label="説明・保証の原文" value={c.conditionNote} onInput={(v) => upd({ conditionNote: v })} multiline />
        <Select label="確認チェックリスト" value={c.checklistCategory} onChange={(v) => upd({ checklistCategory: v })}
          options={[['', '使わない'], ...Object.keys(CHECKLISTS).map((k) => [k, k] as [string, string])]} />
        {(CHECKLISTS[c.checklistCategory] ?? []).map((it) => (
          <div class="tri" key={it}>
            <span>{it}</span>
            {(['ok', 'ng', 'unknown'] as const).map((v) => (
              <button key={v} class={(c.checks[it] ?? 'unknown') === v ? 'on t-' + v : ''} onClick={() => upd({ checks: { ...c.checks, [it]: v } })}>
                {v === 'ok' ? '確認済' : v === 'ng' ? '問題あり' : '未確認'}
              </button>
            ))}
          </div>
        ))}
        <Text label="確定した取扱不可理由（あれば見送り）" value={c.hardBlocker} onInput={(v) => upd({ hardBlocker: v })} placeholder="例：リチウム電池内蔵で配送不可" />
      </Card>

      <SaleSide ev={ev} draft={draft} setDraft={setDraft} updIn={updIn} productId={c.productId} />
      <CostSide ev={ev} draft={draft} setDraft={setDraft} updIn={updIn} />

      <Card title="操作">
        {savedMsg && <p class="ok">{savedMsg}</p>}
        <div class="stack">
          <button class="primary big-btn" onClick={saveSnapshot}>この見積もりを保存</button>
          {c.status === 'open' && (
            <>
              <button onClick={async () => {
                await saveSnapshot();
                const latest = (await listAll<EstimateSnapshot>('estimates')).filter((e) => e.candidateId === c.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
                const inv = await save<InventoryItem>('inventory', {
                  productId: c.productId, candidateId: c.id, estimateId: latest?.id ?? null, status: 'bought', serial: '', condition: c.condition,
                  inspection: '', boughtAt: nowIso(), listedAt: null, soldAt: null,
                  costs: [{ label: '仕入れ値（実額）', amountJPY: c.price }, { label: '国内送料（実額）', amountJPY: c.domesticShipping }],
                  laborHours: null, note: '',
                });
                await save<SaleEvent>('saleEvents', { inventoryId: inv.id, kind: 'status', at: nowIso(), statusTo: 'bought', note: '候補から購入済みに登録' });
                await save<SourcingCandidate>('candidates', { ...c, draft, status: 'bought' });
                await reload();
                go('inventory/' + inv.id);
              }}>購入した → 在庫に登録</button>
              <button onClick={async () => { await save<SourcingCandidate>('candidates', { ...c, draft, status: 'passed' }); await reload(); go('candidates'); }}>見送りにする</button>
            </>
          )}
          {c.status !== 'open' && <button onClick={() => upd({ status: 'open' })}>検討中に戻す</button>}
          <button class="danger ghost" onClick={async () => { await trash('candidates', c.id); await reload(); go('candidates'); }}>ゴミ箱へ</button>
        </div>
      </Card>

      <Card title={`保存した見積もり（${snaps.length}）`}>
        {snaps.length === 0 && <Empty>まだありません</Empty>}
        {snaps.map((s) => (
          <details key={s.id} class="snap">
            <summary><VerdictBadge v={s.verdict} /> {fmtDate(s.createdAt, true)} ／ 標準 {yen(toDec(s.standardE))} ／ 慎重 {yen(toDec(s.cautiousE))}</summary>
            <ul>{s.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            <small class="muted">仕入れ上限 {yen(toDec(s.cmax))} ／ 目標 {yen(toDec(s.targetM))} ／ 設定版 v{s.settingsVersion} ／ {s.evidenceSummary}
              {s.feeProfileSnapshot && ` ／ 手数料「${s.feeProfileSnapshot.name}」v${s.feeProfileSnapshot.version}`}</small>
          </details>
        ))}
      </Card>
    </div>
  );
}

function VerdictCard({ ev }: { ev: Evaluation }) {
  const { data } = useData();
  const s = data.settings;
  const b = ev.std.breakdown;
  return (
    <section class={'card verdict-card vc-' + ev.judge.verdict}>
      <div class="vc-top">
        <VerdictBadge v={ev.judge.verdict} />
        <div class="vc-nums">
          <div><small>予想残額（標準）</small><b>{yen(ev.std.E)}</b></div>
          <div><small>慎重シナリオ</small><b>{yen(ev.cau.E)}</b></div>
          <div><small>仕入れ上限</small><b>{ev.cmax ? yen(ev.cmax) : '—'}</b></div>
        </div>
      </div>
      {ev.freeStillShort && <Warn>無料で仕入れても目標未達（仕入れ上限 {yen(ev.cmax)}）</Warn>}
      <ul class="reasons">{ev.judge.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      <details open>
        <summary>根拠と内訳</summary>
        <p class="muted small">予想残額＝作業代・固定費・所得税等の控除前、予備費控除後。消費税還付は含めません。</p>
        {b ? (
          <table class="bd">
            <tbody>
              <tr><td>売上（(P+S)×r）</td><td>{yen(b.revenueJPY)}</td></tr>
              <tr><td>手数料 F{ev.input.fee.mode === 'profile' ? `（${ev.input.fee.profileName ?? 'プロファイル'} v${ev.input.fee.profileVersion ?? '-'}）` : '（手入力）'}</td><td>−{yen(b.feeJPY)}</td></tr>
              {s.fxMode === 'separate' && <tr><td>為替費用（{s.fxCostPct}%）</td><td>−{yen(b.fxCostJPY)}</td></tr>}
              {(Object.entries(b.costs) as [string, Decimal][]).map(([k, v]) => <tr key={k}><td>{LABELS[k]} {k}</td><td>−{yen(v)}</td></tr>)}
              <tr class="sum"><td>予想残額 E</td><td>{yen(ev.std.E)}</td></tr>
              {ev.std.marginPct && <tr><td>利益率（E÷売上）</td><td>{ev.std.marginPct.toFixed(1)}%</td></tr>}
              {ev.std.afterLabor && <tr><td>作業代控除後</td><td>{yen(ev.std.afterLabor)}</td></tr>}
            </tbody>
          </table>
        ) : <p>未入力：{ev.std.missing.join('、')}</p>}
        <dl class="kv small">
          <dt>目標残額 M</dt><dd>{s.targetM ? yen(toDec(s.targetM)) : '未設定（計算のみ）'}</dd>
          <dt>為替</dt><dd>{ev.input.r ?? '—'} 円/{ev.input.currency}（{s.fxMode === 'inRate' ? '費用はレートに織込み' : '費用は別計上'}）{rateDate(ev, data)}</dd>
          <dt>送料の根拠</dt><dd>{shipBasis(ev, data)}</dd>
          <dt>相場</dt><dd>成約 {ev.stats.n}件 ／ 最終確認 {fmtDate(ev.stats.latestObservedAt)}</dd>
          <dt>慎重条件</dt><dd>売価−{s.cautious.priceDropPct}% ／ 円高{s.cautious.yenStrongPct}% ／ 国際送料+{s.cautious.shippingIncreasePct}%（<a href="#/settings">編集</a>）</dd>
          <dt>設定版</dt><dd>v{s.version}</dd>
        </dl>
        {ev.std.approxReasons.length > 0 && <p class="muted small">概算：{ev.std.approxReasons.join('、')}</p>}
      </details>
    </section>
  );
}

function rateDate(ev: Evaluation, data: ReturnType<typeof useData>['data']) {
  const r = ev.draft.fxRateId ? data.fxRates.find((x) => x.id === ev.draft.fxRateId) : null;
  return r ? ` ／ 確認日 ${fmtDate(r.checkedAt)}` : ' ／ 手入力';
}
function shipBasis(ev: Evaluation, data: ReturnType<typeof useData>['data']) {
  const q = ev.draft.shippingQuoteId ? data.shippingQuotes.find((x) => x.id === ev.draft.shippingQuoteId) : null;
  const dest = ev.draft.destination ? `配送先：${ev.draft.destination}` : '配送先未指定';
  const sh = { yes: '配送可', no: '配送不可', unknown: '配送可否未確認' }[ev.draft.shippable];
  return `${dest} ／ ${sh}${q ? ` ／ 見積「${q.name}」確認日 ${fmtDate(q.checkedAt)}${q.isEstimate ? '（概算）' : ''}` : ' ／ 手入力'}`;
}

interface SideProps { ev: Evaluation; draft: EstimateDraft; setDraft: (d: EstimateDraft) => void; updIn: (p: Partial<EstimateInput>) => void }

function SaleSide({ ev, draft, updIn, productId }: SideProps & { productId: string }) {
  const st = ev.stats;
  return (
    <Card title="売る側（eBay）">
      <div class="evidence">
        <div class="strong">同条件の成約例：{st.n}件 {st.currency && `（${st.currency}）`}</div>
        {st.n > 0 && <div>中央値（商品代＋送料）{st.median?.toFixed(2)} ／ 平均 {st.mean?.toFixed(2)} ／ 範囲 {st.min?.toFixed(2)}〜{st.max?.toFixed(2)}</div>}
        {st.warnings.map((w, i) => <div class="warn-line" key={i}>⚠ {w}</div>)}
        <div class="row wrap">
          {ev.priceMedian && <button class="mini" onClick={() => updIn({ P: ev.priceMedian!.toFixed(2), currency: st.currency ?? draft.input.currency })}>商品代の中央値 {ev.priceMedian.toFixed(2)} をPに</button>}
          {ev.shipMedian && <button class="mini" onClick={() => updIn({ S: ev.shipMedian!.toFixed(2) })}>送料の中央値 {ev.shipMedian.toFixed(2)} をSに</button>}
          <a class="mini btn-like" href={'#/product/' + productId}>成約例を登録・確認</a>
        </div>
      </div>
      <Text label="通貨" value={draft.input.currency} onInput={(v) => updIn({ currency: v.toUpperCase() })} />
      <NumField label="商品売価 P" value={draft.input.P} onChange={(v) => updIn({ P: v })} unit={draft.input.currency} big />
      <NumField label="買い手負担送料 S" value={draft.input.S} onChange={(v) => updIn({ S: v })} unit={draft.input.currency} hint="送料無料で出品するなら0で確定し、国際送料Iを費用側に入れます" />
      <NumField label="徴収税 T（売上に含めない）" value={draft.input.T} onChange={(v) => updIn({ T: v })} unit={draft.input.currency} hint="手数料の課金対象になる場合のみ影響。不明なら空欄（概算表示）" />
    </Card>
  );
}

function CostSide({ ev, draft, setDraft, updIn }: SideProps) {
  const { data } = useData();
  const prof = draft.feeProfileId ? data.feeProfiles.find((f) => f.id === draft.feeProfileId) : null;
  const fee = draft.input.fee;
  const stale = prof && fee.mode === 'profile' && fee.profileVersion !== prof.version;
  return (
    <Card title="費用（円）">
      <Select label="為替レート" value={draft.fxRateId ?? ''} onChange={(v) => {
        const r = data.fxRates.find((x) => x.id === v);
        setDraft({ ...draft, fxRateId: v || null, input: { ...draft.input, r: r ? r.rateJPY : draft.input.r, currency: r ? r.currency : draft.input.currency } });
      }} options={[['', '手入力'], ...data.fxRates.map((r) => [r.id, `${r.currency} ${r.rateJPY}円（${fmtDate(r.checkedAt)}）`] as [string, string])]} />
      <NumField label={`r：1${draft.input.currency}＝何円`} value={draft.input.r} onChange={(v) => setDraft({ ...draft, fxRateId: null, input: { ...draft.input, r: v } })} unit="円" />

      <Select label="手数料" value={fee.mode === 'manual' ? '' : draft.feeProfileId ?? ''} onChange={(v) => {
        const fp = data.feeProfiles.find((f) => f.id === v);
        setDraft({ ...draft, feeProfileId: fp?.id ?? null, input: { ...draft.input, fee: fp ? feeFromProfile(fp) : { mode: 'manual', amountJPY: null, isEstimate: true } } });
      }} options={[['', '手入力（概算/実額）'], ...data.feeProfiles.map((f) => [f.id, `${f.name}（${f.ratePct}%＋${f.fixedPerOrder}${f.currency}）v${f.version}`] as [string, string])]} />
      {stale && <Warn>手数料プロファイルが更新されています（現在 v{prof!.version}）。<button class="mini" onClick={() => updIn({ fee: feeFromProfile(prof!) })}>最新を適用</button></Warn>}
      {fee.mode === 'manual' && (
        <>
          <NumField label="手数料 F（円）" value={fee.amountJPY} onChange={(v) => updIn({ fee: { ...fee, amountJPY: v } })} unit="円" />
          <Check label="概算として扱う" checked={fee.isEstimate} onChange={(v) => updIn({ fee: { ...fee, isEstimate: v } })} />
        </>
      )}
      {data.feeProfiles.length === 0 && <small class="muted">手数料プロファイルは「その他 → 手数料プロファイル」で登録できます。料率は自分の契約・カテゴリーで確認してください。</small>}

      <Text label="配送先（国・地域）" value={draft.destination} onInput={(v) => setDraft({ ...draft, destination: v })} placeholder="例：米国" />
      <Select label="送料見積" value={draft.shippingQuoteId ?? ''} onChange={(v) => {
        const q = data.shippingQuotes.find((x) => x.id === v);
        setDraft({
          ...draft, shippingQuoteId: v || null,
          destination: q ? q.destination : draft.destination,
          shippable: q ? q.shippable : draft.shippable,
          input: { ...draft.input, I: q ? q.amountJPY : draft.input.I },
        });
      }} options={[['', '手入力'], ...data.shippingQuotes.map((q) => [q.id, `${q.name}：${q.destination} ${q.amountJPY ?? '?'}円`] as [string, string])]} />
      <Select label="配送可否" value={draft.shippable} onChange={(v) => setDraft({ ...draft, shippable: v })}
        options={[['unknown', '未確認'], ['yes', '配送できる（確認済み）'], ['no', '配送できない']]} />
      <NumField label="国際送料 I" value={draft.input.I} onChange={(v) => setDraft({ ...draft, shippingQuoteId: null, input: { ...draft.input, I: v } })} unit="円" hint="配送先と梱包後のサイズ・重量で確認した額" />
      <NumField label="梱包費 K" value={draft.input.K} onChange={(v) => updIn({ K: v })} unit="円" />
      <NumField label="購入関連費 A（固定）" value={draft.input.Afixed} onChange={(v) => updIn({ Afixed: v })} unit="円" hint="交通費・購入手数料など" />
      <NumField label="購入関連費 A（仕入れ値比例・任意）" value={draft.input.AratePct} onChange={(v) => updIn({ AratePct: v })} unit="%" />
      <NumField label="修理・清掃費 R" value={draft.input.R} onChange={(v) => updIn({ R: v })} unit="円" />
      <NumField label="関税等（売り手負担）U" value={draft.input.U} onChange={(v) => updIn({ U: v })} unit="円" />
      <NumField label="損失予備費 Q" value={draft.input.Q} onChange={(v) => updIn({ Q: v })} unit="円" hint="返品・破損などへの備え。実績には計上されません" />
      <NumField label="作業時間（任意）" value={draft.input.laborHours ?? null} onChange={(v) => updIn({ laborHours: v })} unit="時間" />
      <NumField label="時給（任意）" value={draft.input.hourlyWage ?? null} onChange={(v) => updIn({ hourlyWage: v as Num })} unit="円" />
      {ev.std.missing.length > 0 && <p class="muted small">未入力：{ev.std.missing.join('、')}</p>}
    </Card>
  );
}
