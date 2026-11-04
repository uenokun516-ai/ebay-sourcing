import { useEffect, useState } from 'preact/hooks';
import { save, trash, nowIso } from '../data/db';
import { REQUEST_STATUS_LABELS, type RequestStatus, type SourcingRequest } from '../core/types';
import { useData, go, productName, fmtDate } from './store';
import { Header, Card, Text, NumField, Select, DateField, Empty, Warn } from './components';

const FLOW: RequestStatus[] = ['received', 'clarifying', 'researching', 'proposed', 'secured', 'listed', 'sold', 'declined', 'expired', 'notfound'];

export function RequestsPage() {
  const { data, reload } = useData();
  const list = [...data.requests].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div>
      <Header title="探し物リクエスト" back="more" right={<button class="btn-sm" onClick={async () => {
        const r = await save<SourcingRequest>('requests', {
          wantedItem: '', referenceAttachmentIds: [], regionLanguage: '', condition: '', accessories: '', budget: null, budgetCurrency: 'USD',
          country: '', deadline: null, contactChannel: 'eBayメッセージ', originalText: '', translation: '', draftReply: '', candidateIds: [],
          status: 'received', history: [{ at: nowIso(), text: '受付（管理者が手入力）' }],
        });
        await reload(); go('request/' + r.id);
      }}>＋追加</button>} />
      <div class="pad"><small class="muted">リクエストは購入の確約ではありません。先払い受付や在庫確保の約束はせず、eBay経由の相手を外部決済へ誘導しません。</small></div>
      {list.length === 0 && <Empty>リクエストはありません</Empty>}
      {list.map((r) => (
        <a class="row-card" href={'#/request/' + r.id} key={r.id}>
          <div class="grow">
            <div class="strong">{r.wantedItem || '（未入力）'}</div>
            <small class="muted">{r.country || '国未入力'} ／ 予算 {r.budget ?? '—'} {r.budgetCurrency} ／ 期限 {fmtDate(r.deadline)}</small>
          </div>
          <span class="pill">{REQUEST_STATUS_LABELS[r.status]}</span>
        </a>
      ))}
    </div>
  );
}

export function RequestPage({ id }: { id: string }) {
  const { data, reload } = useData();
  const orig = data.requests.find((r) => r.id === id);
  const [r, setR] = useState<SourcingRequest | null>(orig ?? null);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { if (orig && (!r || r.id !== orig.id)) setR(orig); }, [orig?.id]);
  if (!orig || !r) return <div><Header title="リクエスト" back="requests" /><Empty>見つかりません</Empty></div>;
  const u = (patch: Partial<SourcingRequest>) => { setR({ ...r, ...patch }); setDirty(true); };
  const persist = async (x: SourcingRequest) => { await save<SourcingRequest>('requests', x); setR(x); setDirty(false); reload(); };
  const offPlatform = /paypal|wise|銀行|振込|bank transfer|外部決済|direct pay/i.test(r.draftReply);

  return (
    <div>
      <Header title={r.wantedItem || 'リクエスト'} back="requests" />
      <Card title="進行状況">
        <div class="chips">
          {FLOW.map((s) => <button key={s} class={r.status === s ? 'on' : ''} onClick={() => persist({ ...r, status: s, history: [...r.history, { at: nowIso(), text: `状態：${REQUEST_STATUS_LABELS[r.status]} → ${REQUEST_STATUS_LABELS[s]}` }] })}>{REQUEST_STATUS_LABELS[s]}</button>)}
        </div>
        {r.status === 'secured' && <Warn>確保した商品が買われないリスクがあります。結果は履歴に残してください。</Warn>}
      </Card>
      <Card title="希望条件">
        <Text label="希望商品" value={r.wantedItem} onInput={(v) => u({ wantedItem: v })} />
        <Text label="地域・言語" value={r.regionLanguage} onInput={(v) => u({ regionLanguage: v })} />
        <Text label="状態" value={r.condition} onInput={(v) => u({ condition: v })} />
        <Text label="付属品" value={r.accessories} onInput={(v) => u({ accessories: v })} />
        <div class="grid2">
          <NumField label="送料込み予算" value={r.budget} onChange={(v) => u({ budget: v })} unit={r.budgetCurrency} />
          <Text label="通貨" value={r.budgetCurrency} onInput={(v) => u({ budgetCurrency: v.toUpperCase() })} />
          <Text label="配送国" value={r.country} onInput={(v) => u({ country: v })} />
          <DateField label="期限" value={r.deadline} onChange={(v) => u({ deadline: v })} />
        </div>
        <Text label="連絡経路" value={r.contactChannel} onInput={(v) => u({ contactChannel: v })} />
        <small class="muted">住所・カード情報は保存しないでください。</small>
      </Card>
      <Card title="依頼文と文案">
        <Text label="依頼文（原文）" value={r.originalText} onInput={(v) => u({ originalText: v })} multiline />
        <Text label="翻訳（手入力）" value={r.translation} onInput={(v) => u({ translation: v })} multiline />
        <Text label="返信の文案（保存のみ・送信しません）" value={r.draftReply} onInput={(v) => u({ draftReply: v })} multiline />
        {offPlatform && <Warn>文案に外部決済・直接取引を示す語があります。eBay外での取引への誘導は規約違反になり得るため、見直してください。</Warn>}
        <button class="mini" onClick={() => navigator.clipboard?.writeText(r.draftReply)}>文案をコピー</button>
      </Card>
      <Card title="候補">
        {r.candidateIds.map((cid) => {
          const c = data.candidates.find((x) => x.id === cid);
          const p = c && data.products.find((x) => x.id === c.productId);
          return <div class="obs" key={cid}><a class="grow" href={'#/candidate/' + cid}>{c ? `${productName(p)} ／ ${c.storeOrSite}` : '（削除済み）'}</a>
            <button class="mini ghost" onClick={() => u({ candidateIds: r.candidateIds.filter((x) => x !== cid) })}>外す</button></div>;
        })}
        <Select label="候補を紐づける" value="" onChange={(v) => v && u({ candidateIds: [...new Set([...r.candidateIds, v])] })}
          options={[['', '選択…'], ...data.candidates.map((c) => [c.id, `${productName(data.products.find((p) => p.id === c.productId))} ／ ${c.storeOrSite || '店舗未入力'}`] as [string, string])]} />
      </Card>
      {dirty && <div class="pad sticky-save"><button class="primary big-btn" onClick={() => persist(r)}>保存</button></div>}
      <Card title="連絡・経過の履歴">
        <div class="row"><input class="grow" value={note} placeholder="例：条件を確認するメッセージを送った" onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
          <button disabled={!note} onClick={() => { persist({ ...r, history: [...r.history, { at: nowIso(), text: note }] }); setNote(''); }}>追加</button></div>
        {[...r.history].reverse().map((h, i) => <div key={i} class="hist"><small class="muted">{fmtDate(h.at, true)}</small> {h.text}</div>)}
      </Card>
      <div class="pad"><button class="danger ghost" onClick={async () => { await trash('requests', id); await reload(); go('requests'); }}>ゴミ箱へ</button></div>
    </div>
  );
}
