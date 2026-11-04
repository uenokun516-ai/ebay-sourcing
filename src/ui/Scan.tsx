import { useEffect, useRef, useState } from 'preact/hooks';
import { parseCode, makeDeduper, type ParsedCode } from '../core/barcode';
import { save } from '../data/db';
import type { Product, ProductCode, SourcingCandidate, ConditionKey, PriceKind } from '../core/types';
import { CONDITION_LABELS, PRICE_KIND_LABELS } from '../core/types';
import { useData, go, productName } from './store';
import { Header, Card, Text, NumField, Select, Warn, Empty } from './components';
import type { Num } from '../core/money';

const FORMATS = ['ean_13', 'ean_8', 'upc_a'];

// ZXing は標準APIがない端末でのみ読み込む（初回表示を軽くするため遅延読み込み）
async function zxingReader() {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A]);
  return new BrowserMultiFormatReader(hints);
}

async function nativeDetector(): Promise<any | null> {
  const BD = (window as any).BarcodeDetector;
  if (!BD) return null;
  try {
    const sup: string[] = await BD.getSupportedFormats();
    const f = FORMATS.filter((x) => sup.includes(x));
    return f.length ? new BD({ formats: f }) : null;
  } catch {
    return null;
  }
}

function Camera({ onDetect, onClose }: { onDetect: (raw: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [engine, setEngine] = useState('');

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let controls: { stop: () => void } | null = null;
    const stopAll = () => {
      stopped = true;
      if (timer) clearInterval(timer);
      try { controls?.stop(); } catch { /* noop */ }
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    const onHide = () => { if (document.visibilityState === 'hidden') { stopAll(); onClose(); } };
    document.addEventListener('visibilitychange', onHide);

    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setErr('このページは HTTPS ではないため、カメラを使えません。手入力か写真から読み取ってください。');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      } catch (e: any) {
        const n = e?.name;
        setErr(n === 'NotAllowedError' ? 'カメラの使用が許可されませんでした。ブラウザの設定で許可するか、手入力してください。'
          : n === 'NotFoundError' ? 'カメラが見つかりません。手入力してください。'
          : 'カメラを開始できませんでした（' + (n || e) + '）。手入力してください。');
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = videoRef.current!;
      v.srcObject = stream;
      v.setAttribute('playsinline', 'true');
      v.muted = true;
      try { await v.play(); } catch { /* iOS は muted+playsinline で再生可 */ }
      const det = await nativeDetector();
      if (det) {
        setEngine('標準 BarcodeDetector');
        timer = window.setInterval(async () => {
          if (stopped || v.readyState < 2) return;
          try {
            const r = await det.detect(v);
            if (r[0]?.rawValue) onDetect(r[0].rawValue);
          } catch { /* 次フレームで再試行 */ }
        }, 250);
      } else {
        setEngine('ZXing');
        try {
          const reader = await zxingReader();
          controls = await reader.decodeFromVideoElement(v, (res) => { if (res && !stopped) onDetect(res.getText()); });
        } catch (e) {
          setErr('読み取りエンジンを開始できませんでした：' + String(e));
        }
      }
    })();
    return () => { document.removeEventListener('visibilitychange', onHide); stopAll(); };
  }, []);

  return (
    <div class="cam">
      {err ? <Warn>{err}</Warn> : (
        <div class="cam-box">
          <video ref={videoRef} playsInline muted />
          <div class="cam-guide" />
        </div>
      )}
      <div class="row">
        <small class="muted">{engine && '読み取り：' + engine + '／暗い場所や反射で読めない時は手入力へ'}</small>
        <button class="danger big-btn" onClick={onClose}>カメラを終了</button>
      </div>
    </div>
  );
}

async function decodeImageFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const det = await nativeDetector();
    if (det) {
      const bmp = await createImageBitmap(file);
      const r = await det.detect(bmp);
      if (r[0]?.rawValue) return r[0].rawValue;
    }
    const res = await (await zxingReader()).decodeFromImageUrl(url);
    return res.getText();
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ScanPage() {
  const { data, reload } = useData();
  const [camOn, setCamOn] = useState(false);
  const [manual, setManual] = useState('');
  const [code, setCode] = useState<ParsedCode | null>(null);
  const [msg, setMsg] = useState('');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Product | null>(null);
  const dedupe = useRef(makeDeduper());

  const accept = (raw: string) => {
    const p = parseCode(raw);
    if (!dedupe.current(p.normalized)) return;
    if (navigator.vibrate) navigator.vibrate(60);
    setCode(p);
    setChosen(null);
    setCamOn(false); // 読み取り後はカメラ停止
  };

  const matches = code
    ? data.codes.filter((c) => c.normalized === code.normalized).map((c) => ({ c, p: data.products.find((p) => p.id === c.productId) })).filter((x) => x.p)
    : [];
  const uniqProducts = [...new Map(matches.map((m) => [m.p!.id, m])).values()];
  const q = query.trim().toLowerCase();
  const searchHits = q
    ? data.products.filter((p) => [p.nameJa, p.nameEn, p.modelNumber, p.searchTerms, p.platform].join(' ').toLowerCase().includes(q)).slice(0, 20)
    : [];

  return (
    <div>
      <Header title="スキャン・店舗モード" />
      <Card>
        {camOn ? (
          <Camera onDetect={accept} onClose={() => setCamOn(false)} />
        ) : (
          <div class="stack">
            <button class="primary big-btn" onClick={() => { setMsg(''); setCamOn(true); }}>📷 バーコードを読み取る</button>
            <label class="btn-like">
              🖼 写真から読み取る
              <input type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (!f) return;
                setMsg('読み取り中…');
                const r = await decodeImageFile(f);
                if (r) { setMsg(''); dedupe.current = makeDeduper(); accept(r); } else setMsg('写真からバーコードを読み取れませんでした。手入力してください。');
                (e.target as HTMLInputElement).value = '';
              }} />
            </label>
          </div>
        )}
        {msg && <p class="muted">{msg}</p>}
        <form class="row" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { dedupe.current = makeDeduper(); accept(manual.trim()); } }}>
          <input class="grow" inputMode="numeric" placeholder="コードを手入力（JAN/EAN/UPC）" value={manual} onInput={(e) => setManual((e.target as HTMLInputElement).value)} />
          <button type="submit">照合</button>
        </form>
      </Card>

      {code && (
        <Card title="読み取り結果">
          <dl class="kv">
            <dt>原コード</dt><dd class="mono">{code.raw}</dd>
            <dt>正規化</dt><dd class="mono">{code.normalized}</dd>
            <dt>種別</dt><dd>{code.type === 'STORE' ? '店舗独自コードの可能性' : code.type}</dd>
            <dt>チェックデジット</dt><dd>{code.checkDigitValid === null ? '判定対象外' : code.checkDigitValid ? '正常' : '不一致（読み違いの可能性）'}</dd>
          </dl>
          {code.checkDigitValid === false && <Warn>チェックデジットが一致しません。もう一度読み取るか、手入力で確認してください。</Warn>}
          {code.storeInternal && <Warn>店舗独自のバーコードの可能性があります。番号だけで商品を断定せず、店名と紐づけて登録してください。</Warn>}

          {uniqProducts.length === 0 ? (
            <div>
              <p class="strong">商品未登録</p>
              <p class="muted">このコードは台帳にありません。価格や商品名は表示しません。商品名・型番を入力して登録できます。</p>
              <NewProductForm code={code} onDone={async (p) => { await reload(); setChosen(p); }} />
            </div>
          ) : (
            <div>
              <p>{uniqProducts.length > 1 ? '候補が複数あります。該当する商品を選んでください。' : '登録済みの商品候補です。実物と一致するか確認してください。'}</p>
              {uniqProducts.map(({ p, c }) => (
                <ProductPick key={p!.id} p={p!} storeName={c.storeName} onPick={() => setChosen(p!)} selected={chosen?.id === p!.id} />
              ))}
            </div>
          )}
        </Card>
      )}

      <Card title="型番・商品名で探す">
        <input placeholder="例：HVC-001、ファミコン" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
        {q && (searchHits.length ? searchHits.map((p) => <ProductPick key={p.id} p={p} onPick={() => setChosen(p)} selected={chosen?.id === p.id} />) : <Empty>該当なし</Empty>)}
      </Card>

      {chosen && <NewCandidateForm product={chosen} onCancel={() => setChosen(null)} />}
    </div>
  );
}

function ProductPick({ p, onPick, selected, storeName }: { p: Product; onPick: () => void; selected: boolean; storeName?: string }) {
  const { data } = useData();
  const open = data.candidates.filter((c) => c.productId === p.id && c.status === 'open');
  return (
    <div class={'pick' + (selected ? ' sel' : '')}>
      <div>
        <div class="strong">{productName(p)}</div>
        <small class="muted">{[p.nameEn, p.platform, p.modelNumber, p.region, p.edition].filter(Boolean).join(' / ')}{storeName ? ` ／店舗コード：${storeName}` : ''}</small>
        {open.length > 0 && (
          <div class="links">既存の候補：{open.map((c) => <a href={'#/candidate/' + c.id} key={c.id}>{c.storeOrSite || '候補'}</a>)}</div>
        )}
      </div>
      <button class={selected ? 'primary' : ''} onClick={onPick}>{selected ? '確認済み' : 'この商品で確定'}</button>
    </div>
  );
}

function NewProductForm({ code, onDone }: { code: ParsedCode; onDone: (p: Product) => void }) {
  const [nameJa, setNameJa] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [model, setModel] = useState('');
  const [platform, setPlatform] = useState('');
  const [storeName, setStoreName] = useState('');
  const can = (nameJa || nameEn || model) && (!code.storeInternal || storeName);
  return (
    <div class="sub">
      <Text label="商品名（日本語）" value={nameJa} onInput={setNameJa} />
      <Text label="商品名（英語）" value={nameEn} onInput={setNameEn} />
      <Text label="型番" value={model} onInput={setModel} />
      <Text label="機種" value={platform} onInput={setPlatform} />
      {code.storeInternal && <Text label="店名（店舗独自コードの紐づけ先・必須）" value={storeName} onInput={setStoreName} />}
      <button class="primary" disabled={!can} onClick={async () => {
        const p = await save<Product>('products', {
          nameJa, nameEn, maker: '', platform, modelNumber: model, region: '', language: '', edition: '', color: '',
          searchTerms: '', imageAttachmentIds: [], checkedAt: null, note: '',
        });
        await save<ProductCode>('productCodes', { productId: p.id, raw: code.raw, normalized: code.normalized, codeType: code.type, storeName, status: 'confirmed' });
        onDone(p);
      }}>台帳に追加して確認</button>
    </div>
  );
}

function NewCandidateForm({ product, onCancel }: { product: Product; onCancel: () => void }) {
  const { reload } = useData();
  const [store, setStore] = useState('');
  const [price, setPrice] = useState<Num>(null);
  const [kind, setKind] = useState<PriceKind>('store');
  const [cond, setCond] = useState<ConditionKey>('used_complete');
  const [condKnown, setCondKnown] = useState(true);
  const [ship, setShip] = useState<Num>(null);
  return (
    <Card title="仕入れ候補として入力" right={<button class="ghost" onClick={onCancel}>閉じる</button>}>
      <p class="strong">{productName(product)}</p>
      <Text label="店名・サイト" value={store} onInput={setStore} placeholder="例：〇〇リサイクル 本店" />
      <NumField label="店頭価格・仕入れ値" value={price} onChange={setPrice} unit="円" big />
      <Select label="価格の種類" value={kind} onChange={setKind} options={Object.entries(PRICE_KIND_LABELS) as [PriceKind, string][]} />
      <Select label="状態" value={condKnown ? cond : ('other' as ConditionKey)} onChange={(v) => { setCond(v); setCondKnown(true); }} options={Object.entries(CONDITION_LABELS) as [ConditionKey, string][]} />
      <NumField label="国内送料（店頭なら0）" value={ship} onChange={setShip} unit="円" />
      <button class="primary big-btn" onClick={async () => {
        const c = await save<SourcingCandidate>('candidates', {
          productId: product.id, storeOrSite: store, url: '', price, priceKind: kind, domesticShipping: ship,
          condition: cond, conditionNote: '', checklistCategory: '', checks: {}, hardBlocker: '', productConfirmed: true,
          status: 'open', draft: null, note: '',
        });
        await reload();
        go('candidate/' + c.id);
      }}>保存して採算を判定 →</button>
    </Card>
  );
}
