import { useEffect, useMemo, useState } from 'preact/hooks';
import { save, trash, nowIso } from '../data/db';
import { upsertRecord, adoptAsSold } from '../data/records';
import {
  buildRecord, matchWarnings, canAdoptAsSold, parseCsv, guessMapping, cleanNumber, CSV_FIELDS,
  MATCH_LABELS, SOCIAL_LABELS, type MatchStatus, type NewRecord, type SourceRecord, type SocialClass,
} from '../core/records';
import {
  parseSourceUrl, VERIFICATION, SOURCE_LABELS, SOURCE_TYPE_LABELS, CONN_STATUS_LABELS, dedupeKey, type SourceType,
} from '../core/sources';
import { CONDITION_LABELS, type ConditionKey } from '../core/types';
import { callWorker } from '../core/lookup';
import { useData, go, productName, fmtDate } from './store';
import { Header, Card, Text, NumField, Select, DateField, Empty, Warn, ExtLink } from './components';

const TYPE_OPTS = Object.entries(SOURCE_TYPE_LABELS) as [SourceType, string][];
const COND_OPTS = Object.entries(CONDITION_LABELS) as [ConditionKey, string][];

function blank(): NewRecord {
  return {
    url: '', sourceType: 'active_listing', method: 'manual', observedAt: nowIso(), publishedAt: null, soldAt: null, endsAt: null,
    titleRaw: '', bodyText: '', nameJa: '', nameEn: '', modelNumber: '', code: '', region: '', edition: '', color: '',
    condition: 'unknown', accessories: '', quantity: '1', price: null, shipping: null, currency: 'JPY', priceKind: 'fixed',
    buyNowPrice: null, stockStatus: 'unknown', productId: null, matchStatus: 'unidentified', matchNote: '', socialClass: null, evidence: '',
  };
}

// ---------------- 手動取り込み ----------------
export function ImportPage() {
  const { data, reload } = useData();
  const [r, setR] = useState<NewRecord>(blank());
  const [msg, setMsg] = useState('');
  const u = (p: Partial<NewRecord>) => setR({ ...r, ...p });
  const parsed = r.url.trim() ? parseSourceUrl(r.url) : null;
  const dup = parsed ? data.records.find((x) => x.dedupeKey === dedupeKey(parsed.source, parsed.itemId, parsed.canonicalUrl, r.sourceType)) : null;
  const prod = data.products.find((p) => p.id === r.productId);
  const warns = matchWarnings(r, prod);

  useEffect(() => {
    if (!parsed) return;
    const cur = parsed.source === 'ebay' ? 'USD' : 'JPY';
    if (parsed.source === 'yahoo_auction' && r.sourceType === 'active_listing') setR((x) => ({ ...x, sourceType: 'auction_bid', priceKind: 'current_bid', currency: cur }));
    else if ((parsed.source === 'x' || parsed.source === 'youtube') && r.sourceType !== 'social_signal') setR((x) => ({ ...x, sourceType: 'social_signal', socialClass: 'unknown' }));
    else setR((x) => ({ ...x, currency: x.currency === 'JPY' || x.currency === 'USD' ? cur : x.currency }));
  }, [parsed?.source]);

  return (
    <div>
      <Header title="手動で取り込む" back="records" />
      <Card title="出典">
        <Text label="URL" value={r.url} onInput={(v) => u({ url: v })} type="url" placeholder="https://…" />
        {parsed && (parsed.ok
          ? <small class="muted">{SOURCE_LABELS[parsed.source]} ／ 商品ID {parsed.itemId ?? '不明'} ／ 保存URL {parsed.canonicalUrl}</small>
          : <Warn>URLとして読み取れません。「リンクのみ」として保存されます。</Warn>)}
        <small class="muted">URLを登録しても、ページの中身は自動では読み込みません。価格や本文は自分で確認して入力してください（ログイン画面などは取り込まないでください）。</small>
        {dup && <Warn>同じ商品がすでに取り込まれています。保存すると件数は増えず、価格が変わっていれば履歴に追加されます。<a href={'#/record/' + dup.id}>既存を開く</a></Warn>}
        <Select label="データの種類" value={r.sourceType} onChange={(v) => u({ sourceType: v, priceKind: v === 'sold_observation' ? 'sold' : v === 'auction_bid' ? 'current_bid' : v === 'catalog_reference' ? 'reference' : 'fixed', socialClass: v === 'social_signal' ? 'unknown' : null })} options={TYPE_OPTS} />
      </Card>

      <Card title="内容">
        <Text label="商品名（原文のまま）" value={r.titleRaw} onInput={(v) => u({ titleRaw: v })} />
        <Text label="説明文（コピーした本文）" value={r.bodyText} onInput={(v) => u({ bodyText: v })} multiline />
        {r.sourceType === 'social_signal' ? (
          <>
            <Select label="投稿・動画の分類" value={(r.socialClass ?? 'unknown') as SocialClass} onChange={(v) => u({ socialClass: v })} options={Object.entries(SOCIAL_LABELS) as [SocialClass, string][]} />
            <DateField label="投稿日・公開日" value={r.publishedAt} onChange={(v) => u({ publishedAt: v })} />
            <small class="muted">話題は「調べるきっかけ」として保存します。需要や販売数としては扱いません。動画は、タイトル・説明など自分で確認した範囲だけを記録してください。</small>
          </>
        ) : (
          <>
            <div class="grid2">
              <NumField label={r.sourceType === 'auction_bid' ? '現在の入札額' : r.sourceType === 'sold_observation' ? '成約価格' : '価格'} value={r.price} onChange={(v) => u({ price: v })} unit={r.currency} />
              <NumField label="送料（不明なら空欄）" value={r.shipping} onChange={(v) => u({ shipping: v })} unit={r.currency} />
              <Text label="通貨" value={r.currency} onInput={(v) => u({ currency: v.toUpperCase() })} />
              <NumField label="個数" value={r.quantity} onChange={(v) => u({ quantity: v })} />
            </div>
            {r.sourceType === 'auction_bid' && (
              <div class="grid2">
                <DateField label="終了日" value={r.endsAt} onChange={(v) => u({ endsAt: v })} />
                <NumField label="即決価格（なければ空欄）" value={r.buyNowPrice} onChange={(v) => u({ buyNowPrice: v })} unit={r.currency} />
              </div>
            )}
            {r.sourceType === 'auction_bid' && <small class="muted">現在の入札額は仕入れ確定額ではありません。入札はこのアプリでは行いません。</small>}
            {r.sourceType === 'sold_observation' && <DateField label="販売日" value={r.soldAt} onChange={(v) => u({ soldAt: v })} />}
            <Select label="状態" value={r.condition} onChange={(v) => u({ condition: v })} options={COND_OPTS} />
            <div class="grid2">
              <Text label="地域（日本版など）" value={r.region} onInput={(v) => u({ region: v })} />
              <Text label="版（通常/限定）" value={r.edition} onInput={(v) => u({ edition: v })} />
              <Text label="型番" value={r.modelNumber} onInput={(v) => u({ modelNumber: v })} />
              <Text label="JAN/UPC" value={r.code} onInput={(v) => u({ code: v.replace(/\D/g, '') })} />
            </div>
            <Text label="付属品" value={r.accessories} onInput={(v) => u({ accessories: v })} />
          </>
        )}
        <Text label="根拠メモ（どこで確認したか）" value={r.evidence} onInput={(v) => u({ evidence: v })} placeholder="例：eBay Product Research で確認" />
      </Card>

      <Card title="商品との照合">
        <Select label="対応する商品（台帳）" value={r.productId ?? ''} onChange={(v) => u({ productId: v || null, matchStatus: v ? 'candidate' : 'unidentified' })}
          options={[['', '未特定'], ...data.products.map((p) => [p.id, productName(p)] as [string, string])]} />
        {warns.map((w, i) => <div class="warn-line" key={i}>⚠ {w}</div>)}
        <small class="muted">保存時は「一致候補」になります。一致の確定は一覧の詳細画面で行います。</small>
      </Card>

      <div class="pad">
        {msg && <p class="ok">{msg}</p>}
        <button class="primary big-btn" disabled={!r.url.trim() && !r.titleRaw.trim()} onClick={async () => {
          const res = await upsertRecord(buildRecord({ ...r, url: r.url.trim() || 'manual:' + crypto.randomUUID() }));
          await reload();
          setMsg(res.status === 'new' ? '新しく保存しました' : res.status === 'updated' ? '既存のデータに価格の変化を記録しました' : '同じ内容がすでにあるため件数は増やしていません');
          setR({ ...blank(), sourceType: r.sourceType, currency: r.currency, productId: r.productId, matchStatus: r.productId ? 'candidate' : 'unidentified' });
        }}>保存</button>
      </div>
    </div>
  );
}

// ---------------- CSV取り込み ----------------
export function CsvImportPage() {
  const { data, reload } = useData();
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<string, number>>({});
  const [type, setType] = useState<SourceType>('sold_observation');
  const [cur, setCur] = useState('USD');
  const [pid, setPid] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const header = rows[0] ?? [];
  const body = rows.slice(1);

  const build = (row: string[]): NewRecord | null => {
    const g = (k: string) => (map[k] !== undefined ? (row[map[k]] ?? '').trim() : '');
    const title = g('titleRaw');
    const url = g('url');
    if (!title && !url) return null;
    const sold = g('soldAt');
    const d = sold ? new Date(sold) : null;
    return {
      ...blank(), url: url || `csv:${g('sourceItemId') || title}`, sourceType: type, method: 'csv', titleRaw: title,
      price: cleanNumber(g('price')), shipping: cleanNumber(g('shipping')), currency: (g('currency') || cur).toUpperCase(),
      soldAt: d && !isNaN(d.getTime()) ? d.toISOString() : null, code: g('code').replace(/\D/g, ''),
      priceKind: type === 'sold_observation' ? 'sold' : 'fixed', stockStatus: type === 'sold_observation' ? 'sold_out' : 'unknown',
      productId: pid || null, matchStatus: pid ? 'candidate' : 'unidentified', evidence: 'CSV取り込み',
    };
  };
  const preview = useMemo(() => { const seen = new Set<string>(); return body.map((row) => {
    const nr = build(row);
    if (!nr) return { nr, state: '無効（商品名もURLもない）' };
    const b = buildRecord(nr);
    const dup = data.records.some((x) => x.dedupeKey === b.dedupeKey) || seen.has(b.dedupeKey);
    seen.add(b.dedupeKey);
    return { nr, state: dup ? '重複（価格の変化のみ記録）' : !nr.price && type !== 'social_signal' ? '新規（価格なし）' : '新規' };
  }); }, [rows, map, type, cur, pid, data.records]);

  return (
    <div>
      <Header title="CSVで取り込む" back="records" />
      <Card title="1. ファイルを選ぶ">
        <input type="file" accept=".csv,text/csv" onChange={async (e) => {
          setErr(''); setMsg('');
          const f = (e.target as HTMLInputElement).files?.[0];
          if (!f) return;
          if (f.size > 2_000_000) { setErr('2MBまでのファイルにしてください'); return; }
          const parsed = parseCsv(await f.text());
          if (parsed.length < 2) { setErr('データ行がありません'); return; }
          if (parsed.length > 2001) { setErr('一度に取り込めるのは2000行までです'); return; }
          setRows(parsed); setMap(guessMapping(parsed[0]));
        }} />
        {err && <Warn>{err}</Warn>}
        <small class="muted">1行目を見出しとして扱います。自分で集めた表や、許可された方法で書き出したデータを使ってください。</small>
      </Card>
      {rows.length > 0 && (
        <>
          <Card title="2. 列を対応づける">
            <Select label="データの種類" value={type} onChange={setType} options={TYPE_OPTS} />
            <Text label="通貨（列がない場合）" value={cur} onInput={(v) => setCur(v.toUpperCase())} />
            <Select label="対応する商品（全行・任意）" value={pid} onChange={setPid} options={[['', '未特定'], ...data.products.map((p) => [p.id, productName(p)] as [string, string])]} />
            {CSV_FIELDS.map((f) => (
              <Select key={f.key} label={f.label} value={String(map[f.key] ?? '')} onChange={(v) => { const m = { ...map }; if (v === '') delete m[f.key]; else m[f.key] = Number(v); setMap(m); }}
                options={[['', '使わない'], ...header.map((h, i) => [String(i), h || `列${i + 1}`] as [string, string])]} />
            ))}
          </Card>
          <Card title={`3. プレビュー（${body.length}行）`}>
            <table class="bd small">
              <tbody>
                {preview.slice(0, 15).map((p, i) => (
                  <tr key={i}><td>{p.nr?.titleRaw.slice(0, 40) || '—'}</td><td>{p.nr?.price ?? '—'} {p.nr?.currency}</td><td>{p.state}</td></tr>
                ))}
              </tbody>
            </table>
            {body.length > 15 && <small class="muted">ほか {body.length - 15} 行</small>}
            <p class="small">新規 {preview.filter((p) => p.state.startsWith('新規')).length} ／ 重複 {preview.filter((p) => p.state.startsWith('重複')).length} ／ 無効 {preview.filter((p) => p.state.startsWith('無効')).length}</p>
            {msg && <p class="ok">{msg}</p>}
            <button class="primary big-btn" onClick={async () => {
              const c = { new: 0, updated: 0, unchanged: 0 };
              for (const p of preview) if (p.nr) c[(await upsertRecord(buildRecord(p.nr))).status]++;
              await reload();
              setMsg(`取り込み完了：新規 ${c.new}件・価格変化 ${c.updated}件・変化なし ${c.unchanged}件`);
            }}>取り込む</button>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------- 一覧 ----------------
export function RecordsPage() {
  const { data } = useData();
  const [type, setType] = useState<SourceType | 'all'>('all');
  const [ms, setMs] = useState<MatchStatus | 'all'>('all');
  const list = data.records
    .filter((r) => (type === 'all' || r.sourceType === type) && (ms === 'all' || r.matchStatus === ms))
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  return (
    <div>
      <Header title="取り込みデータ" back="more" />
      <div class="row wrap pad">
        <a class="btn-like mini" href="#/import">＋手動で取り込む</a>
        <a class="btn-like mini" href="#/import-csv">CSVで取り込む</a>
        <a class="btn-like mini" href="#/sources">接続状態</a>
      </div>
      <div class="chips">
        <button class={type === 'all' ? 'on' : ''} onClick={() => setType('all')}>すべて {data.records.length}</button>
        {TYPE_OPTS.map(([k, l]) => <button key={k} class={type === k ? 'on' : ''} onClick={() => setType(k)}>{l} {data.records.filter((r) => r.sourceType === k).length}</button>)}
      </div>
      <div class="chips">
        <button class={ms === 'all' ? 'on' : ''} onClick={() => setMs('all')}>照合：すべて</button>
        {(Object.keys(MATCH_LABELS) as MatchStatus[]).map((k) => <button key={k} class={ms === k ? 'on' : ''} onClick={() => setMs(k)}>{MATCH_LABELS[k]}</button>)}
      </div>
      {list.length === 0 && <Empty>データはまだありません</Empty>}
      {list.map((r) => {
        const p = data.products.find((x) => x.id === r.productId);
        return (
          <a class="row-card" href={'#/record/' + r.id} key={r.id}>
            <div class="grow">
              <div class="strong small">{r.titleRaw || r.canonicalUrl}</div>
              <small class="muted">{SOURCE_LABELS[r.source]} ／ {SOURCE_TYPE_LABELS[r.sourceType]} ／ {r.price ?? '—'} {r.currency}{r.shipping !== null ? ` ＋送料${r.shipping}` : ' ＋送料不明'} ／ {fmtDate(r.observedAt)}</small>
              <div><small class="muted">{p ? productName(p) : '商品未特定'}{r.adoptedObservationId ? ' ／ 成約例に採用済み' : ''}{r.history.length > 1 ? ` ／ 価格履歴 ${r.history.length}件` : ''}</small></div>
            </div>
            <span class={'pill m-' + r.matchStatus}>{MATCH_LABELS[r.matchStatus]}</span>
          </a>
        );
      })}
    </div>
  );
}

// ---------------- 詳細・照合 ----------------
export function RecordPage({ id }: { id: string }) {
  const { data, reload } = useData();
  const rec = data.records.find((r) => r.id === id);
  const [pid, setPid] = useState(rec?.productId ?? '');
  const [note, setNote] = useState(rec?.matchNote ?? '');
  const [msg, setMsg] = useState('');
  if (!rec) return <div><Header title="データ" back="records" /><Empty>見つかりません</Empty></div>;
  const prod = data.products.find((p) => p.id === (pid || rec.productId));
  const warns = matchWarnings(rec, prod);
  const adopt = canAdoptAsSold({ ...rec, productId: pid || rec.productId });
  const setStatus = async (s: MatchStatus) => {
    await save<SourceRecord>('sourceRecords', { ...rec, productId: s === 'unidentified' ? null : pid || rec.productId, matchStatus: s, matchNote: note });
    await reload();
    setMsg('照合状態を「' + MATCH_LABELS[s] + '」にしました');
  };
  return (
    <div>
      <Header title={SOURCE_TYPE_LABELS[rec.sourceType]} back="records" />
      <Card title={rec.titleRaw || '（商品名なし）'}>
        <dl class="kv small">
          <dt>出典</dt><dd>{SOURCE_LABELS[rec.source]}（{rec.method === 'api' ? 'API' : rec.method === 'csv' ? 'CSV' : rec.method === 'link_only' ? 'リンクのみ' : '手動'}） <ExtLink url={rec.canonicalUrl} /></dd>
          <dt>商品ID</dt><dd>{rec.sourceItemId ?? '不明'}</dd>
          <dt>価格</dt><dd>{rec.price ?? '—'} {rec.currency}（{rec.priceKind === 'current_bid' ? '現在入札額' : rec.priceKind === 'sold' ? '成約' : rec.priceKind === 'reference' ? '参考' : '出品価格'}） ＋送料 {rec.shipping ?? '不明'}</dd>
          {rec.buyNowPrice && <><dt>即決</dt><dd>{rec.buyNowPrice} {rec.currency}</dd></>}
          {rec.endsAt && <><dt>終了</dt><dd>{fmtDate(rec.endsAt)}</dd></>}
          {rec.soldAt && <><dt>販売日</dt><dd>{fmtDate(rec.soldAt)}</dd></>}
          {rec.publishedAt && <><dt>投稿日</dt><dd>{fmtDate(rec.publishedAt)}</dd></>}
          {rec.socialClass && <><dt>分類</dt><dd>{SOCIAL_LABELS[rec.socialClass]}</dd></>}
          <dt>状態</dt><dd>{CONDITION_LABELS[rec.condition]} {rec.region} {rec.edition}</dd>
          <dt>観測</dt><dd>初回 {fmtDate(rec.firstObservedAt, true)} ／ 最新 {fmtDate(rec.observedAt, true)}</dd>
          <dt>根拠</dt><dd>{rec.evidence || '—'}</dd>
        </dl>
        {rec.bodyText && <details><summary>説明文（外部の文章）</summary><p class="small pre">{rec.bodyText}</p></details>}
        {rec.history.length > 1 && (
          <details open><summary>価格の履歴（{rec.history.length}）</summary>
            {rec.history.map((h, i) => <div class="hist small" key={i}>{fmtDate(h.at, true)}：{h.price ?? '—'} {h.currency} ＋送料 {h.shipping ?? '不明'} ／ {h.stockStatus}</div>)}
          </details>
        )}
      </Card>

      <Card title={`商品との照合：${MATCH_LABELS[rec.matchStatus]}`}>
        <Select label="対応する商品" value={pid} onChange={setPid} options={[['', '未特定'], ...data.products.map((p) => [p.id, productName(p)] as [string, string])]} />
        <Select label="状態" value={rec.condition} onChange={async (v) => { await save<SourceRecord>('sourceRecords', { ...rec, condition: v }); await reload(); }} options={COND_OPTS} />
        {prod && <small class="muted">台帳：{[prod.nameEn, prod.platform, prod.modelNumber, prod.region, prod.edition].filter(Boolean).join(' / ')}</small>}
        {warns.length > 0 ? warns.map((w, i) => <div class="warn-line" key={i}>⚠ {w}</div>) : <small class="muted">記載からは明らかな差分は見つかりませんでした（地域・付属品・動作は自分で確認してください）。</small>}
        <Text label="照合メモ" value={note} onInput={setNote} placeholder="例：型番 MGB-101 を写真で確認" />
        <div class="row wrap">
          <button class="primary" disabled={!pid} onClick={() => setStatus('confirmed')}>一致を確認した</button>
          <button disabled={!pid} onClick={() => setStatus('candidate')}>一致候補</button>
          <button onClick={() => setStatus('mismatch')}>不一致</button>
          <button onClick={() => setStatus('unidentified')}>未特定に戻す</button>
        </div>
        {msg && <p class="ok small">{msg}</p>}
      </Card>

      {rec.sourceType === 'sold_observation' && (
        <Card title="成約例として採用">
          <p class="small">採用すると、商品の成約例として相場の統計と利益計算の根拠に使われます（既存の計算と同じ経路）。</p>
          {!adopt.ok && <small class="muted">{adopt.reason}</small>}
          <button class="primary" disabled={!adopt.ok || rec.matchStatus !== 'confirmed'} onClick={async () => {
            const r = await adoptAsSold(rec.id);
            await reload();
            setMsg(r.ok ? '成約例として採用しました' : r.reason);
          }}>成約例として採用</button>
        </Card>
      )}
      {rec.sourceType !== 'sold_observation' && (
        <Card><small class="muted">{rec.sourceType === 'social_signal' ? '話題は調査のきっかけです。依頼や需要として扱いません。' : '出品・入札・参考価格は、成約の統計や判定には入りません。'}</small></Card>
      )}
      <div class="pad"><button class="danger ghost" onClick={async () => { await trash('sourceRecords', rec.id); await reload(); go('records'); }}>ゴミ箱へ</button></div>
    </div>
  );
}

// ---------------- 接続状態・データ取得検証表 ----------------
export function SourcesPage() {
  const { data } = useData();
  const s = data.settings;
  const [live, setLive] = useState<{ yahoo: boolean; ebay: boolean } | string | null>(null);
  const live2 = (src: string, base: string) => {
    if (!s.workerUrl) return base;
    if (live && typeof live === 'object') {
      if (src === 'ebay') return live.ebay ? 'available' : 'awaiting_setup';
      if (src === 'yahoo_shopping') return live.yahoo ? 'available' : 'awaiting_setup';
    }
    return base;
  };
  return (
    <div>
      <Header title="接続状態・取得検証表" back="records" />
      <Card>
        <p class="small">各サービスから何を・どの方法で取れるかの一覧です（確認日 2026-11-04）。「利用可能」は中継サーバーで実際に接続できた場合だけ表示します。</p>
        <button class="mini" disabled={!s.workerUrl} onClick={async () => {
          try { setLive(await callWorker<{ yahoo: boolean; ebay: boolean }>(s.workerUrl, s.appKey, 'health', {})); }
          catch (e) { setLive((e as Error).message); }
        }}>中継サーバーの接続を確認</button>
        {!s.workerUrl && <small class="muted"> 中継サーバー未設定</small>}
        {typeof live === 'string' && <Warn>{live}</Warn>}
      </Card>
      {VERIFICATION.map((v) => {
        const st = live2(v.source, v.status);
        return (
          <section class="card" key={v.source}>
            <div class="card-h"><h2>{SOURCE_LABELS[v.source]}</h2><span class={'pill c-' + st}>{CONN_STATUS_LABELS[st as keyof typeof CONN_STATUS_LABELS]}</span></div>
            <dl class="kv small">
              <dt>役割</dt><dd>{v.role}</dd>
              <dt>方式</dt><dd>{v.method}</dd>
              <dt>種類</dt><dd>{v.types.map((t) => SOURCE_TYPE_LABELS[t]).join('・')}</dd>
              <dt>前提</dt><dd>{v.prerequisites}</dd>
              <dt>制限</dt><dd>{v.limits}</dd>
              <dt>取得項目</dt><dd>{v.obtained}</dd>
              <dt>実データ</dt><dd>{v.realDataVerified ? '確認済み' : '未確認'}（{v.note}）</dd>
              <dt>根拠</dt><dd>{v.evidence.map((e) => <div key={e.url}><a href={e.url} target="_blank" rel="noopener noreferrer">{e.title} ↗</a></div>)}</dd>
            </dl>
          </section>
        );
      })}
      <Card><small class="muted">定期実行・通知・費用上限は、各接続が「利用可能」になってから有効化します（現状は未実装）。週1の定期リサーチはWeb検索のみで動いています。</small></Card>
    </div>
  );
}

