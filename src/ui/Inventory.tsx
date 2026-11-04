import { useEffect, useState } from 'preact/hooks';
import { save, trash, nowIso } from '../data/db';
import { computeActual, toDec, yen, type Num } from '../core/money';
import {
  CONDITION_LABELS, INV_STATUS_LABELS, type ConditionKey, type InvStatus, type InventoryItem, type SaleEvent, type SaleEventKind,
} from '../core/types';
import { useData, go, productName, fmtDate } from './store';
import { Header, Card, Text, NumField, Select, Empty, DateField, Warn } from './components';

const ORDER: InvStatus[] = ['candidate', 'bought', 'inspecting', 'preparing', 'listed', 'sold', 'shipped', 'done'];
const EVENT_LABELS: Record<SaleEventKind, string> = {
  status: '状態変更', sale: '売却（入金）', return: '返品', cancel: 'キャンセル', refund: '返金', dispose: '処分', note: 'メモ',
};

export function actualFor(item: InventoryItem, events: SaleEvent[]) {
  const ev = events.filter((e) => e.inventoryId === item.id && !e.deletedAt);
  const sale = ev.filter((e) => e.kind === 'sale').sort((a, b) => b.at.localeCompare(a.at))[0];
  const refunds = ev.filter((e) => e.kind === 'refund' || e.kind === 'return').reduce((s, e) => s + Number(toDec(e.refundJPY ?? null) ?? 0), 0);
  if (!sale) return { value: null, missing: ['売却記録'], hasSale: false };
  const r = computeActual({
    mode: sale.payoutMode ?? 'net', grossJPY: sale.grossJPY ?? null, feesJPY: sale.feesJPY ?? null, netPayoutJPY: sale.netPayoutJPY ?? null,
    refundsJPY: String(refunds), costsJPY: item.costs.map((c) => c.amountJPY),
  });
  return { ...r, hasSale: true };
}

export function InventoryPage() {
  const { data } = useData();
  const [st, setSt] = useState<InvStatus | 'all'>('all');
  const list = data.inventory.filter((i) => st === 'all' || i.status === st).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div>
      <Header title="在庫・実績" />
      <div class="chips">
        <button class={st === 'all' ? 'on' : ''} onClick={() => setSt('all')}>すべて {data.inventory.length}</button>
        {ORDER.map((s) => {
          const n = data.inventory.filter((i) => i.status === s).length;
          return n ? <button key={s} class={st === s ? 'on' : ''} onClick={() => setSt(s)}>{INV_STATUS_LABELS[s]} {n}</button> : null;
        })}
      </div>
      {list.length === 0 && <Empty>在庫はまだありません。候補画面の「購入した → 在庫に登録」から追加されます。</Empty>}
      {list.map((i) => {
        const p = data.products.find((x) => x.id === i.productId);
        const est = data.estimates.find((e) => e.id === i.estimateId);
        const act = actualFor(i, data.saleEvents);
        return (
          <a class="row-card" href={'#/inventory/' + i.id} key={i.id}>
            <div class="grow">
              <div class="strong">{productName(p)}</div>
              <small class="muted">{INV_STATUS_LABELS[i.status]} ／ 仕入れ {fmtDate(i.boughtAt)}</small>
            </div>
            <div class="right">
              <small>予想 {yen(toDec(est?.standardE ?? null))}</small>
              <small>実績 {act.value ? yen(act.value) : '—'}</small>
            </div>
          </a>
        );
      })}
    </div>
  );
}

export function InventoryItemPage({ id }: { id: string }) {
  const { data, reload } = useData();
  const orig = data.inventory.find((i) => i.id === id);
  const [it, setIt] = useState<InventoryItem | null>(orig ?? null);
  const [dirty, setDirty] = useState(false);
  const [evKind, setEvKind] = useState<SaleEventKind>('sale');
  const [payMode, setPayMode] = useState<'gross' | 'net'>('net');
  const [gross, setGross] = useState<Num>(null);
  const [fees, setFees] = useState<Num>(null);
  const [net, setNet] = useState<Num>(null);
  const [refund, setRefund] = useState<Num>(null);
  const [evNote, setEvNote] = useState('');
  useEffect(() => { if (orig && (!it || it.id !== orig.id)) setIt(orig); }, [orig?.id]);
  if (!orig || !it) return <div><Header title="在庫" back="inventory" /><Empty>見つかりません</Empty></div>;

  const p = data.products.find((x) => x.id === it.productId);
  const est = data.estimates.find((e) => e.id === it.estimateId);
  const events = data.saleEvents.filter((e) => e.inventoryId === id).sort((a, b) => b.at.localeCompare(a.at));
  const act = actualFor(it, data.saleEvents);
  const u = (patch: Partial<InventoryItem>) => { setIt({ ...it, ...patch }); setDirty(true); };

  const changeStatus = async (s: InvStatus) => {
    const dates: Partial<InventoryItem> = {};
    if (s === 'listed' && !it.listedAt) dates.listedAt = nowIso();
    if (s === 'sold' && !it.soldAt) dates.soldAt = nowIso();
    const next = { ...it, ...dates, status: s };
    await save<InventoryItem>('inventory', next);
    await save<SaleEvent>('saleEvents', { inventoryId: id, kind: 'status', at: nowIso(), statusTo: s, note: `${INV_STATUS_LABELS[it.status]} → ${INV_STATUS_LABELS[s]}` });
    setIt(next); setDirty(false); reload();
  };

  return (
    <div>
      <Header title={productName(p)} back="inventory" />
      <Card title="状態">
        <div class="chips">
          {ORDER.map((s) => <button key={s} class={it.status === s ? 'on' : ''} onClick={() => changeStatus(s)}>{INV_STATUS_LABELS[s]}</button>)}
        </div>
        <small class="muted">状態を変えると履歴に記録されます（上書きしません）。返品・キャンセル・処分は下の「イベント」で記録します。</small>
      </Card>

      <Card title="予想と実績（別計算）">
        <table class="bd">
          <tbody>
            <tr><td>予想残額（保存した見積もり）</td><td>{yen(toDec(est?.standardE ?? null))}</td></tr>
            <tr><td>慎重シナリオ</td><td>{yen(toDec(est?.cautiousE ?? null))}</td></tr>
            <tr class="sum"><td>実績残額</td><td>{act.value ? yen(act.value) : '未確定（' + act.missing.join('、') + '）'}</td></tr>
          </tbody>
        </table>
        <small class="muted">実績＝入金（控除後入金なら手数料は再控除しない）−返金−実費。予備費は実支出でないため含めません。売上額そのものを利益として表示しません。</small>
        {est && <div><a href={'#/candidate/' + est.candidateId}>見積もりの根拠を開く</a></div>}
      </Card>

      <Card title="個体・検品">
        <Select label="状態" value={it.condition} onChange={(v) => u({ condition: v as ConditionKey })} options={Object.entries(CONDITION_LABELS) as [ConditionKey, string][]} />
        <Text label="シリアル番号（出品文へ自動挿入しません）" value={it.serial} onInput={(v) => u({ serial: v })} />
        <Text label="検品記録" value={it.inspection} onInput={(v) => u({ inspection: v })} multiline />
        <div class="grid2">
          <DateField label="仕入れ日" value={it.boughtAt} onChange={(v) => u({ boughtAt: v })} />
          <DateField label="出品日" value={it.listedAt} onChange={(v) => u({ listedAt: v })} />
          <DateField label="売却日" value={it.soldAt} onChange={(v) => u({ soldAt: v })} />
          <NumField label="作業時間" value={it.laborHours} onChange={(v) => u({ laborHours: v })} unit="時間" />
        </div>
        <Text label="メモ" value={it.note} onInput={(v) => u({ note: v })} multiline />
      </Card>

      <Card title="実費（円）" right={<button class="mini" onClick={() => u({ costs: [...it.costs, { label: '', amountJPY: null }] })}>＋行</button>}>
        {it.costs.map((c, i) => (
          <div class="cost-row" key={i}>
            <input value={c.label} placeholder="項目（国際送料・梱包など）" onInput={(e) => { const costs = [...it.costs]; costs[i] = { ...c, label: (e.target as HTMLInputElement).value }; u({ costs }); }} />
            <input inputMode="decimal" value={c.amountJPY ?? ''} placeholder="未入力" onInput={(e) => { const v = (e.target as HTMLInputElement).value.replace(/[^\d.\-]/g, ''); const costs = [...it.costs]; costs[i] = { ...c, amountJPY: v || null }; u({ costs }); }} />
            <button class="mini ghost" onClick={() => u({ costs: it.costs.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
      </Card>
      {dirty && <div class="pad sticky-save"><button class="primary big-btn" onClick={async () => { await save<InventoryItem>('inventory', it); setDirty(false); reload(); }}>変更を保存</button></div>}

      <Card title="イベントを記録">
        <Select label="種類" value={evKind} onChange={setEvKind} options={(['sale', 'return', 'refund', 'cancel', 'dispose', 'note'] as SaleEventKind[]).map((k) => [k, EVENT_LABELS[k]])} />
        {evKind === 'sale' && (
          <>
            <Select label="入金の記録方法" value={payMode} onChange={setPayMode} options={[['net', '控除後入金（手数料差引後）'], ['gross', '売上と手数料を別々に']]} />
            {payMode === 'net' ? <NumField label="控除後入金" value={net} onChange={setNet} unit="円" /> : (
              <>
                <NumField label="売上（円）" value={gross} onChange={setGross} unit="円" />
                <NumField label="実手数料" value={fees} onChange={setFees} unit="円" />
              </>
            )}
          </>
        )}
        {(evKind === 'refund' || evKind === 'return') && <NumField label="返金額" value={refund} onChange={setRefund} unit="円" />}
        <Text label="メモ" value={evNote} onInput={setEvNote} />
        <button class="primary" onClick={async () => {
          await save<SaleEvent>('saleEvents', {
            inventoryId: id, kind: evKind, at: nowIso(), note: evNote,
            ...(evKind === 'sale' ? { payoutMode: payMode, grossJPY: gross, feesJPY: fees, netPayoutJPY: net } : {}),
            ...(evKind === 'refund' || evKind === 'return' ? { refundJPY: refund } : {}),
          });
          setGross(null); setFees(null); setNet(null); setRefund(null); setEvNote('');
          reload();
        }}>記録</button>
        {events.filter((e) => e.kind === 'sale').length > 1 && <Warn>売却記録が複数あります。実績には最新の1件を使います。</Warn>}
      </Card>

      <Card title="履歴">
        {events.length === 0 && <Empty>なし</Empty>}
        {events.map((e) => (
          <div class="obs" key={e.id}>
            <div class="grow">
              <b>{EVENT_LABELS[e.kind]}</b> {e.note}
              {e.kind === 'sale' && <small> ／ {e.payoutMode === 'gross' ? `売上 ${e.grossJPY ?? '—'} − 手数料 ${e.feesJPY ?? '—'}` : `控除後入金 ${e.netPayoutJPY ?? '—'}`}</small>}
              {e.refundJPY && <small> ／ 返金 {e.refundJPY}</small>}
              <div><small class="muted">{fmtDate(e.at, true)}</small></div>
            </div>
            {e.kind !== 'status' && <button class="mini ghost" onClick={async () => { await trash('saleEvents', e.id); reload(); }}>取消</button>}
          </div>
        ))}
      </Card>
      <div class="pad"><button class="danger ghost" onClick={async () => { await trash('inventory', id); await reload(); go('inventory'); }}>ゴミ箱へ</button></div>
    </div>
  );
}
