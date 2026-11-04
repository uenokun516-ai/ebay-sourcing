import { createContext } from 'preact';
import { useContext, useEffect, useState, useCallback } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { listAll, getSettings } from '../data/db';
import type {
  Product, ProductCode, MarketObservation, SourcingCandidate, FeeProfile, ShippingQuote, FxRate,
  EstimateSnapshot, SourcingRequest, InventoryItem, SaleEvent, Attachment, Settings,
} from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
import type { SourceRecord } from '../core/records';

export interface AllData {
  products: Product[];
  codes: ProductCode[];
  observations: MarketObservation[];
  candidates: SourcingCandidate[];
  feeProfiles: FeeProfile[];
  shippingQuotes: ShippingQuote[];
  fxRates: FxRate[];
  estimates: EstimateSnapshot[];
  requests: SourcingRequest[];
  inventory: InventoryItem[];
  saleEvents: SaleEvent[];
  attachments: Attachment[];
  records: SourceRecord[];
  settings: Settings;
}

const empty: AllData = {
  products: [], codes: [], observations: [], candidates: [], feeProfiles: [], shippingQuotes: [], fxRates: [],
  estimates: [], requests: [], inventory: [], saleEvents: [], attachments: [], records: [], settings: DEFAULT_SETTINGS,
};

interface Ctx { data: AllData; loaded: boolean; error: string | null; reload: () => Promise<void> }
const DataCtx = createContext<Ctx>({ data: empty, loaded: false, error: null, reload: async () => {} });

export function DataProvider({ children }: { children: ComponentChildren }) {
  const [data, setData] = useState<AllData>(empty);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const [products, codes, observations, candidates, feeProfiles, shippingQuotes, fxRates, estimates, requests, inventory, saleEvents, attachments, records, settings] =
        await Promise.all([
          listAll<Product>('products'), listAll<ProductCode>('productCodes'), listAll<MarketObservation>('observations'),
          listAll<SourcingCandidate>('candidates'), listAll<FeeProfile>('feeProfiles'), listAll<ShippingQuote>('shippingQuotes'),
          listAll<FxRate>('fxRates'), listAll<EstimateSnapshot>('estimates'), listAll<SourcingRequest>('requests'),
          listAll<InventoryItem>('inventory'), listAll<SaleEvent>('saleEvents'), listAll<Attachment>('attachments'), listAll<SourceRecord>('sourceRecords'), getSettings(),
        ]);
      setData({ products, codes, observations, candidates, feeProfiles, shippingQuotes, fxRates, estimates, requests, inventory, saleEvents, attachments, records, settings });
      setError(null);
    } catch (e) {
      setError('データを読み込めませんでした：' + String(e));
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return <DataCtx.Provider value={{ data, loaded, error, reload }}>{children}</DataCtx.Provider>;
}

export const useData = () => useContext(DataCtx);

// ---- ハッシュルーター ----
export function useRoute(): string[] {
  const [h, setH] = useState(location.hash);
  useEffect(() => {
    const f = () => { setH(location.hash); window.scrollTo(0, 0); };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return h.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}
export const go = (path: string) => { location.hash = '#/' + path.replace(/^\//, ''); };

export function productName(p?: Product) {
  if (!p) return '（商品不明）';
  return (p.isDemo ? '【架空デモ】' : '') + (p.nameJa || p.nameEn || '名称未入力');
}

export function fmtDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
}

/** 日付入力(YYYY-MM-DD)をUTC ISOへ（Asia/Tokyoの0時として扱う） */
export function dateInputToIso(v: string): string | null {
  if (!v) return null;
  return new Date(v + 'T00:00:00+09:00').toISOString();
}
export function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 9 * 3600000);
  return d.toISOString().slice(0, 10);
}
export const todayIso = () => dateInputToIso(isoToDateInput(new Date().toISOString()))!;
