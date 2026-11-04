// データモデル。全レコードに id / createdAt / updatedAt（UTC ISO文字列）。削除はゴミ箱（deletedAt）経由。
import type { EstimateInput, CautiousParams, Num } from './money';
import type { CodeType } from './barcode';

export interface Base {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface Product extends Base {
  nameJa: string;
  nameEn: string;
  maker: string;
  platform: string; // 機種
  modelNumber: string; // 型番
  region: string; // 地域（日本版/北米版など）
  language: string;
  edition: string; // 版（通常/限定）
  color: string;
  searchTerms: string;
  imageAttachmentIds: string[];
  checkedAt: string | null;
  isDemo?: boolean; // 架空デモ商品
  note: string;
}

export interface ProductCode extends Base {
  productId: string;
  raw: string;
  normalized: string;
  codeType: CodeType;
  storeName: string; // 店舗独自コードの場合の店名
  status: 'unconfirmed' | 'confirmed';
}

export type ConditionKey = 'new_sealed' | 'used_complete' | 'used_loose' | 'used_boxed_no_manual' | 'junk' | 'other' | 'unknown';
export const CONDITION_LABELS: Record<ConditionKey, string> = {
  new_sealed: '新品・未開封',
  used_complete: '中古・完品（箱説付）',
  used_boxed_no_manual: '中古・箱あり説明書なし',
  used_loose: '中古・本体のみ',
  junk: 'ジャンク',
  other: 'その他（メモ参照）',
  unknown: '状態不明',
};

export interface MarketObservation extends Base {
  productId: string;
  condition: ConditionKey;
  kind: 'sold' | 'listing'; // 成約 / 出品中
  url: string;
  source: string; // eBay Product Research 等
  observedAt: string; // 確認日
  soldAt: string | null; // 販売日
  currency: string;
  price: Num;
  shipping: Num; // null = 送料不明
  region: string;
  accessories: string;
  isLot: boolean; // まとめ売り
  adopted: boolean; // 統計に採用
  excludeReason: string;
  note: string;
}

export type PriceKind = 'fixed' | 'current_bid' | 'buy_now' | 'store';
export const PRICE_KIND_LABELS: Record<PriceKind, string> = {
  fixed: '出品価格（定額）',
  current_bid: '現在入札額（最終額ではない）',
  buy_now: '即決価格',
  store: '店頭価格',
};

export interface SourcingCandidate extends Base {
  productId: string;
  storeOrSite: string;
  url: string;
  price: Num;
  priceKind: PriceKind;
  domesticShipping: Num;
  condition: ConditionKey;
  conditionNote: string; // 説明原文
  checklistCategory: string; // ゲーム / ゲーム機 / ホビー
  checks: Record<string, 'ok' | 'ng' | 'unknown'>;
  hardBlocker: string; // 確定した取扱不可理由
  productConfirmed: boolean; // 本人が商品を確認済みか
  status: 'open' | 'bought' | 'passed';
  draft: EstimateDraft | null; // 入力途中の見積もり
  note: string;
}

export interface EstimateDraft {
  input: EstimateInput;
  destination: string;
  shippable: 'yes' | 'no' | 'unknown';
  shippingQuoteId: string | null;
  fxRateId: string | null;
  feeProfileId: string | null;
}

export interface FeeProfile extends Base {
  name: string;
  ratePct: Num;
  fixedPerOrder: Num;
  currency: string;
  baseIncludesShipping: boolean;
  baseIncludesTax: boolean;
  isEstimate: boolean;
  source: string;
  checkedAt: string | null;
  version: number;
}

export interface ShippingQuote extends Base {
  name: string; // 例：米国・小型包装物 500g
  destination: string;
  method: string;
  weightG: Num;
  sizeNote: string;
  amountJPY: Num;
  shippable: 'yes' | 'no' | 'unknown';
  source: string;
  checkedAt: string | null;
  isEstimate: boolean;
}

export interface FxRate extends Base {
  currency: string;
  rateJPY: Num;
  source: string;
  checkedAt: string | null;
}

export type Verdict = 'undetermined' | 'pass' | 'conditional' | 'candidate';
export const VERDICT_LABELS: Record<Verdict, string> = {
  undetermined: '判定できない',
  pass: '見送り',
  conditional: '条件付き',
  candidate: '仕入れ候補',
};

export interface EstimateSnapshot extends Base {
  productId: string;
  candidateId: string | null;
  input: EstimateInput;
  cautious: CautiousParams;
  targetM: Num;
  destination: string;
  shippable: 'yes' | 'no' | 'unknown';
  settingsVersion: number;
  feeProfileSnapshot: FeeProfile | null;
  evidenceObservationIds: string[];
  evidenceSummary: string;
  standardE: string | null;
  cautiousE: string | null;
  cmax: string | null;
  verdict: Verdict;
  reasons: string[];
  missing: string[];
}

export type RequestStatus =
  | 'received' | 'clarifying' | 'researching' | 'proposed' | 'secured'
  | 'listed' | 'sold' | 'declined' | 'expired' | 'notfound';
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  received: '受付',
  clarifying: '条件確認',
  researching: '調査中',
  proposed: '候補提示',
  secured: '確保/検品',
  listed: '出品案内',
  sold: '購入成立',
  declined: '辞退',
  expired: '期限切れ',
  notfound: '未発見',
};

export interface HistoryEntry {
  at: string;
  text: string;
}

export interface SourcingRequest extends Base {
  wantedItem: string;
  referenceAttachmentIds: string[];
  regionLanguage: string;
  condition: string;
  accessories: string;
  budget: Num; // 送料込み予算
  budgetCurrency: string;
  country: string;
  deadline: string | null;
  contactChannel: string; // 例：eBayメッセージ（外部決済への誘導はしない）
  originalText: string;
  translation: string;
  draftReply: string; // 文案（保存のみ・送信しない）
  candidateIds: string[];
  status: RequestStatus;
  history: HistoryEntry[];
}

export type InvStatus = 'candidate' | 'bought' | 'inspecting' | 'preparing' | 'listed' | 'sold' | 'shipped' | 'done';
export const INV_STATUS_LABELS: Record<InvStatus, string> = {
  candidate: '候補',
  bought: '購入済',
  inspecting: '検品中',
  preparing: '出品準備',
  listed: '出品中',
  sold: '売却',
  shipped: '発送',
  done: '完了',
};

export interface InventoryItem extends Base {
  productId: string;
  candidateId: string | null;
  estimateId: string | null;
  status: InvStatus;
  serial: string; // 公開文へ自動挿入しない
  condition: ConditionKey;
  inspection: string;
  boughtAt: string | null;
  listedAt: string | null;
  soldAt: string | null;
  costs: { label: string; amountJPY: Num }[];
  laborHours: Num;
  note: string;
}

export type SaleEventKind = 'status' | 'sale' | 'return' | 'cancel' | 'refund' | 'dispose' | 'note';
export interface SaleEvent extends Base {
  inventoryId: string;
  kind: SaleEventKind;
  at: string;
  statusTo?: InvStatus;
  payoutMode?: 'gross' | 'net';
  grossJPY?: Num;
  feesJPY?: Num;
  netPayoutJPY?: Num;
  refundJPY?: Num;
  note: string;
}

export interface Attachment extends Base {
  relatedType: string;
  relatedId: string;
  fileName: string;
  mime: string;
  dataUrl: string;
  source: string;
  rightsNote: string; // 権利・個人情報注意
  extraction: 'none' | 'pending' | 'approved';
}

export interface Settings {
  id: 'settings';
  version: number; // 設定版（見積もりスナップショットに記録）
  targetM: Num; // 目標残額（未設定なら計算のみ）
  maxPerItemJPY: Num;
  defaultCurrency: string;
  fxMode: 'inRate' | 'separate';
  fxCostPct: Num;
  cautious: CautiousParams;
  researchWindowDays: number; // 90
  staleDays: number; // 30
  minComparable: number; // 5
  hourlyWage: Num;
  lastBackupAt: string | null;
  updatedAt: string;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  version: 1,
  targetM: null,
  maxPerItemJPY: null,
  defaultCurrency: 'USD',
  fxMode: 'inRate',
  fxCostPct: null,
  cautious: { priceDropPct: '10', yenStrongPct: '5', shippingIncreasePct: '15' },
  researchWindowDays: 90,
  staleDays: 30,
  minComparable: 5,
  hourlyWage: null,
  lastBackupAt: null,
  updatedAt: new Date(0).toISOString(),
};

export const CHECKLISTS: Record<string, string[]> = {
  ゲーム: ['日本版/海外版', '言語', '地域制限', '型番', '通常/限定版', '正規品確認', '箱・説明書', 'ディスク傷', '起動確認', 'セーブ確認'],
  ゲーム機: ['画面', 'ボタン', '端子', '音声', '充電', 'バッテリー状態', '電源仕様', '付属品', '修理/改造歴', '輸送可否'],
  ホビー: ['メーカー', 'シリーズ', '商品番号', '正規品確認', '欠品', '破損', '箱', '梱包サイズ'],
};
