// 金額計算コア。すべて decimal.js で計算し、表示時のみ丸める。
// 未入力は null、0 はユーザーが確認して入力した値として区別する。
import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Num = string | null; // 入力値は文字列で保持（先頭ゼロ・小数誤差対策）

export type FeeInput =
  | {
      mode: 'profile';
      profileId?: string;
      profileName?: string;
      profileVersion?: number;
      ratePct: Num; // 料率（%）
      fixedPerOrder: Num; // 固定額（販売通貨）
      baseIncludesShipping: boolean; // 買い手負担送料が課金対象か
      baseIncludesTax: boolean; // 買い手徴収税が課金対象か
      isEstimate: boolean;
    }
  | { mode: 'manual'; amountJPY: Num; isEstimate: boolean };

export interface EstimateInput {
  P: Num; // 商品売価（外貨）
  S: Num; // 買い手負担送料（外貨）
  T: Num; // プラットフォーム徴収税（外貨・売上に含めない）
  currency: string;
  r: Num; // 1外貨＝何円
  fxMode: 'inRate' | 'separate'; // 為替費用：レートに織り込む／別計上（排他）
  fxCostPct: Num; // separate のときのみ使用
  fee: FeeInput;
  C: Num; // 仕入れ値
  D: Num; // 国内送料
  Afixed: Num; // 購入関連費（固定）
  AratePct: Num; // 購入関連費（仕入れ値比例 %）
  R: Num; // 修理・清掃
  I: Num; // 国際送料
  K: Num; // 梱包
  U: Num; // 売り手負担関税等
  Q: Num; // 損失予備費
  laborHours?: Num;
  hourlyWage?: Num;
}

export interface Breakdown {
  revenueJPY: Decimal; // (P+S)×r
  feeJPY: Decimal;
  fxCostJPY: Decimal;
  costs: Record<'C' | 'D' | 'A' | 'R' | 'I' | 'K' | 'U' | 'Q', Decimal>;
}

export interface EstimateResult {
  complete: boolean;
  missing: string[]; // 未入力項目のラベル
  approxReasons: string[]; // 概算扱いの理由
  breakdown?: Breakdown;
  E?: Decimal; // 予想残額（作業代・固定費・所得税等控除前、予備費控除後）
  afterLabor?: Decimal; // 任意の作業代控除後
  marginPct?: Decimal | null; // E / ((P+S)×r)。分母0なら null
}

export const LABELS: Record<string, string> = {
  P: '商品売価',
  S: '買い手負担送料',
  T: '徴収税',
  r: '為替レート',
  fxCostPct: '為替費用率',
  fee: 'eBay等手数料',
  C: '仕入れ値',
  D: '国内送料',
  A: '購入関連費',
  R: '修理・清掃費',
  I: '国際送料',
  K: '梱包費',
  U: '関税等（売り手負担）',
  Q: '損失予備費',
};

export function isEntered(v: Num | undefined): v is string {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

export function toDec(v: Num | undefined): Decimal | null {
  if (!isEntered(v)) return null;
  const s = String(v).replace(/,/g, '').trim();
  try {
    const d = new Decimal(s);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** 手数料（円）を計算。T が課金対象で未入力の場合は 0 とみなし概算扱い。 */
export function computeFeeJPY(
  fee: FeeInput,
  P: Decimal,
  S: Decimal,
  T: Decimal | null,
  r: Decimal,
): { fee: Decimal | null; missing: string[]; approx: string[] } {
  const missing: string[] = [];
  const approx: string[] = [];
  if (fee.mode === 'manual') {
    const a = toDec(fee.amountJPY);
    if (!a) missing.push(LABELS.fee);
    if (fee.isEstimate) approx.push('手数料は手入力の概算');
    return { fee: a, missing, approx };
  }
  const rate = toDec(fee.ratePct);
  const fixed = toDec(fee.fixedPerOrder);
  if (!rate || !fixed) {
    missing.push(LABELS.fee + '（料率・固定額）');
    return { fee: null, missing, approx };
  }
  let base = P;
  if (fee.baseIncludesShipping) base = base.plus(S);
  if (fee.baseIncludesTax) {
    if (T) base = base.plus(T);
    else approx.push('徴収税が不明のため手数料は概算');
  }
  if (fee.isEstimate) approx.push('手数料プロファイルが概算設定');
  const feeFx = base.times(rate).div(100).plus(fixed);
  return { fee: feeFx.times(r), missing, approx };
}

export function computeEstimate(inp: EstimateInput): EstimateResult {
  const missing: string[] = [];
  const approxReasons: string[] = [];
  const get = (k: keyof EstimateInput, label = LABELS[k as string]) => {
    const d = toDec(inp[k] as Num);
    if (!d) missing.push(label);
    return d;
  };
  const P = get('P');
  const S = get('S');
  const r = get('r');
  const T = toDec(inp.T);
  const C = get('C');
  const D = get('D');
  const Afixed = toDec(inp.Afixed);
  const Arate = toDec(inp.AratePct);
  if (!Afixed) missing.push(LABELS.A);
  const R = get('R');
  const I = get('I');
  const K = get('K');
  const U = get('U');
  const Q = get('Q');
  let fxPct: Decimal | null = new Decimal(0);
  if (inp.fxMode === 'separate') fxPct = get('fxCostPct');

  let feeJPY: Decimal | null = null;
  if (P && S && r) {
    const f = computeFeeJPY(inp.fee, P, S, T, r);
    feeJPY = f.fee;
    missing.push(...f.missing);
    approxReasons.push(...f.approx);
  } else if (inp.fee.mode === 'manual' && !toDec(inp.fee.amountJPY)) {
    missing.push(LABELS.fee);
  }

  if (missing.length || !P || !S || !r || !C || !D || !Afixed || !R || !I || !K || !U || !Q || !fxPct || !feeJPY) {
    return { complete: false, missing: [...new Set(missing)], approxReasons };
  }
  const revenueJPY = P.plus(S).times(r);
  const fxCostJPY = inp.fxMode === 'separate' ? revenueJPY.times(fxPct).div(100) : new Decimal(0);
  const A = Afixed.plus(Arate ? C.times(Arate).div(100) : 0);
  const costs = { C, D, A, R, I, K, U, Q };
  let E = revenueJPY.minus(feeJPY).minus(fxCostJPY);
  for (const v of Object.values(costs)) E = E.minus(v);
  const marginPct = revenueJPY.isZero() ? null : E.div(revenueJPY).times(100);
  let afterLabor: Decimal | undefined;
  const h = toDec(inp.laborHours ?? null);
  const w = toDec(inp.hourlyWage ?? null);
  if (h && w) afterLabor = E.minus(h.times(w));
  return {
    complete: true,
    missing: [],
    approxReasons,
    breakdown: { revenueJPY, feeJPY, fxCostJPY, costs },
    E,
    afterLabor,
    marginPct,
  };
}

/**
 * 仕入れ上限 Cmax：同じ利益計算関数を使い、目標残額 M を満たす最大の C を求める。
 * E は C について線形（購入関連費の比例分を含む）なので、C=0 と C=1 の2点から傾きを得て解く。
 * 負の値は「無料でも目標未達」を意味し、そのまま根拠として返す。
 */
export function computeCmax(inp: EstimateInput, M: Num): { cmax: Decimal | null; freeStillShort: boolean } {
  const m = toDec(M);
  if (!m) return { cmax: null, freeStillShort: false };
  const e0 = computeEstimate({ ...inp, C: '0' });
  const e1 = computeEstimate({ ...inp, C: '1' });
  if (!e0.complete || !e1.complete || !e0.E || !e1.E) return { cmax: null, freeStillShort: false };
  const slope = e0.E.minus(e1.E); // 1円あたりの減少額（>0）
  if (slope.lte(0)) return { cmax: null, freeStillShort: false };
  const cmax = e0.E.minus(m).div(slope).toDecimalPlaces(0, Decimal.ROUND_FLOOR);
  return { cmax, freeStillShort: cmax.isNegative() };
}

export interface CautiousParams {
  priceDropPct: Num; // 売価下落率
  yenStrongPct: Num; // 円高幅（レートを何%下げるか）
  shippingIncreasePct: Num; // 国際送料の増額率
}

/** 慎重シナリオの入力を作る。料率型手数料は computeEstimate 内で自動再計算される。 */
export function cautiousInput(inp: EstimateInput, cp: CautiousParams): EstimateInput {
  const pct = (v: Num) => toDec(v) ?? new Decimal(0);
  const scale = (v: Num, f: Decimal) => {
    const d = toDec(v);
    return d ? d.times(f).toString() : v;
  };
  return {
    ...inp,
    P: scale(inp.P, new Decimal(1).minus(pct(cp.priceDropPct).div(100))),
    r: scale(inp.r, new Decimal(1).minus(pct(cp.yenStrongPct).div(100))),
    I: scale(inp.I, new Decimal(1).plus(pct(cp.shippingIncreasePct).div(100))),
  };
}

// ---- 実績残額（予想とは別計算） ----
export interface ActualInput {
  mode: 'gross' | 'net'; // gross: 売上と手数料を別入力／net: 控除後入金
  grossJPY: Num; // 売上（円）
  feesJPY: Num; // 実手数料（gross のときのみ）
  netPayoutJPY: Num; // 控除後入金（net のとき：手数料は再控除しない）
  refundsJPY: Num;
  costsJPY: Num[]; // 実費（仕入れ・送料・梱包等）
}

export function computeActual(a: ActualInput): { value: Decimal | null; missing: string[] } {
  const missing: string[] = [];
  let base: Decimal | null;
  if (a.mode === 'net') {
    base = toDec(a.netPayoutJPY);
    if (!base) missing.push('控除後入金');
  } else {
    const g = toDec(a.grossJPY);
    const f = toDec(a.feesJPY);
    if (!g) missing.push('売上');
    if (!f) missing.push('実手数料');
    base = g && f ? g.minus(f) : null;
  }
  if (!base) return { value: null, missing };
  let v = base.minus(toDec(a.refundsJPY) ?? 0);
  for (const c of a.costsJPY) v = v.minus(toDec(c) ?? 0);
  // 予備費は実支出ではないため加えない
  return { value: v, missing };
}

export function yen(d: Decimal | null | undefined): string {
  if (!d) return '—';
  const v = d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return (v.isNegative() ? '−' : '') + '¥' + v.abs().toNumber().toLocaleString('ja-JP');
}
