import { useState } from 'preact/hooks';
import { callWorker, searchLinks, medianOf, LookupError, type YahooResult, type EbayResult } from '../core/lookup';
import { save } from '../data/db';
import type { MarketObservation } from '../core/types';
import { useData, fmtDate, todayIso } from './store';
import { Warn } from './components';

/** バーコード・商品名からネット上の情報を調べるパネル。結果は参考で、採用は本人が判断する。 */
export function NetLookup({ code, keyword, productId, onUseName }: {
  code: string; keyword: string; productId?: string; onUseName?: (ja: string) => void;
}) {
  const { data, reload } = useData();
  const s = data.settings;
  const [yahoo, setYahoo] = useState<YahooResult | null>(null);
  const [ebay, setEbay] = useState<EbayResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string[]>([]);
  const [saved, setSaved] = useState('');
  const configured = !!s.workerUrl;

  const run = async () => {
    setBusy(true); setErr([]); setSaved('');
    const errs: string[] = [];
    const p: Record<string, string> = code ? { jan: code } : { q: keyword };
    const [y, e] = await Promise.allSettled([
      callWorker<YahooResult>(s.workerUrl, s.appKey, 'yahoo', p),
      callWorker<EbayResult>(s.workerUrl, s.appKey, 'ebay', { ...p, market: s.ebayMarket }),
    ]);
    if (y.status === 'fulfilled') setYahoo(y.value); else errs.push('Yahoo!：' + (y.reason as LookupError).message);
    if (e.status === 'fulfilled') setEbay(e.value); else errs.push('eBay：' + (e.reason as LookupError).message);
    // GTINで0件なら英語名・型番のキーワードで再検索
    if (e.status === 'fulfilled' && e.value.total === 0 && code && keyword) {
      try { setEbay(await callWorker<EbayResult>(s.workerUrl, s.appKey, 'ebay', { q: keyword, market: s.ebayMarket })); } catch { /* 先の結果を表示 */ }
    }
    setErr(errs); setBusy(false);
  };

  const saveEbay = async () => {
    if (!ebay || !productId) return;
    let n = 0;
    for (const it of ebay.items.slice(0, 20)) {
      if (!it.price) continue;
      await save<MarketObservation>('observations', {
        productId, condition: 'unknown', kind: 'listing', url: it.url, source: ebay.source + ' ' + ebay.market,
        observedAt: todayIso(), soldAt: null, currency: it.currency || 'USD', price: it.price, shipping: it.shipping,
        region: it.location || '', accessories: '', isLot: false, adopted: false,
        excludeReason: '出品中の参考価格（成約ではない）', note: (it.condition || '') + ' ' + it.title.slice(0, 120),
      });
      n++;
    }
    await reload();
    setSaved(`出品中の参考価格として ${n} 件保存しました（成約の統計には入りません）`);
  };

  const ebayPrices = ebay?.items.map((i) => i.price) ?? [];
  const med = medianOf(ebayPrices);

  return (
    <div class="netlookup">
      <div class="strong">ネットで調べる</div>
      {!configured ? (
        <small class="muted">自動検索を使うには「その他 → 設定 → ネット検索」で中継サーバーを設定します。下のリンクはいつでも使えます。</small>
      ) : (
        <button class="primary" disabled={busy || (!code && !keyword)} onClick={run}>{busy ? '検索中…' : '🔎 Yahoo!・eBay を自動検索'}</button>
      )}
      {err.map((e, i) => <Warn key={i}>{e}</Warn>)}

      {yahoo && (
        <div class="lk-block">
          <div class="lk-h">Yahoo!ショッピング：{yahoo.total ?? yahoo.items.length}件 <small class="muted">（国内の出品・主に新品）</small></div>
          {yahoo.items.length === 0 && <small class="muted">見つかりませんでした。古い商品やレトロゲームはここに無いことが多いです。</small>}
          {yahoo.items.slice(0, 5).map((it, i) => (
            <div class="lk-item" key={i}>
              {it.image && <img src={it.image} alt="" loading="lazy" referrerpolicy="no-referrer" />}
              <div class="grow">
                <div class="lk-name">{it.name}</div>
                <small class="muted">¥{Number(it.price).toLocaleString()} ／ {it.condition === 'used' ? '中古' : '新品'} ／ {it.seller}</small>
              </div>
              {onUseName && <button class="mini" onClick={() => onUseName(it.name)}>この名前を使う</button>}
            </div>
          ))}
          <small class="muted">商品名は候補です。実物の型番・版と一致するか確認してください。</small>
        </div>
      )}

      {ebay && (
        <div class="lk-block">
          <div class="lk-h">eBay 出品中：{ebay.total.toLocaleString()}件 <small class="muted">（{ebay.market}・成約ではない）</small></div>
          {ebay.items.length > 0 && <div>出品価格の中央値 {med?.toFixed(2)} {ebay.items[0].currency}（上位{ebay.items.length}件・送料別）</div>}
          {ebay.items.slice(0, 6).map((it, i) => (
            <a class="lk-item" key={i} href={it.url} target="_blank" rel="noopener noreferrer">
              {it.image && <img src={it.image} alt="" loading="lazy" referrerpolicy="no-referrer" />}
              <div class="grow">
                <div class="lk-name">{it.title}</div>
                <small class="muted">{it.price} {it.currency} ＋送料 {it.shipping ?? '不明'} ／ {it.condition ?? '状態不明'} ／ {it.location ?? ''}</small>
              </div>
            </a>
          ))}
          {productId && ebay.items.length > 0 && <button class="mini" onClick={saveEbay}>出品中の参考価格として保存</button>}
          {saved && <p class="ok small">{saved}</p>}
          <small class="muted">出品価格は「売れた値段」ではありません。成約例は下の「eBay 売却済み」で確認して登録してください。取得 {fmtDate(ebay.fetchedAt, true)}</small>
        </div>
      )}

      <div class="lk-links">
        {searchLinks(code, keyword).map((l) => (
          <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer" class="lk-link"><b>{l.label} ↗</b><small>{l.note}</small></a>
        ))}
      </div>
    </div>
  );
}
