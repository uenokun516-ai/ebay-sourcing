// 候補の採算評価：入力ドラフト＋設定＋相場から、2シナリオ・仕入れ上限・判定をまとめて出す。
import Decimal from 'decimal.js';
import { computeEstimate, computeCmax, cautiousInput, toDec, type EstimateInput, type EstimateResult } from '../core/money';
import { computeStats, type StatsResult } from '../core/stats';
import { judge, type JudgeResult } from '../core/judge';
import { CHECKLISTS, type EstimateDraft, type FeeProfile, type SourcingCandidate, type Settings } from '../core/types';
import type { AllData } from './store';

export function defaultDraft(c: SourcingCandidate, settings: Settings, profiles: FeeProfile[]): EstimateDraft {
  const prof = profiles[0];
  const input: EstimateInput = {
    P: null, S: null, T: null, currency: settings.defaultCurrency, r: null,
    fxMode: settings.fxMode, fxCostPct: settings.fxCostPct,
    fee: prof ? feeFromProfile(prof) : { mode: 'manual', amountJPY: null, isEstimate: true },
    C: c.price, D: c.domesticShipping, Afixed: null, AratePct: null, R: null, I: null, K: null, U: null, Q: null,
    laborHours: null, hourlyWage: settings.hourlyWage,
  };
  return { input, destination: '', shippable: 'unknown', shippingQuoteId: null, fxRateId: null, feeProfileId: prof?.id ?? null };
}

export function feeFromProfile(p: FeeProfile): EstimateInput['fee'] {
  return {
    mode: 'profile', profileId: p.id, profileName: p.name, profileVersion: p.version, ratePct: p.ratePct,
    fixedPerOrder: p.fixedPerOrder, baseIncludesShipping: p.baseIncludesShipping, baseIncludesTax: p.baseIncludesTax, isEstimate: p.isEstimate,
  };
}

export interface Evaluation {
  draft: EstimateDraft;
  input: EstimateInput; // 候補の最新値（C, D）を反映した入力
  std: EstimateResult;
  cau: EstimateResult;
  cmax: Decimal | null;
  freeStillShort: boolean;
  stats: StatsResult;
  priceMedian: Decimal | null;
  shipMedian: Decimal | null;
  judge: JudgeResult;
  unconfirmed: string[];
  blockers: string[];
}

export function evaluate(c: SourcingCandidate, draft: EstimateDraft, data: AllData): Evaluation {
  const s = data.settings;
  // 仕入れ値・国内送料は候補側を正とする
  const input: EstimateInput = { ...draft.input, C: c.price, D: c.domesticShipping, fxMode: s.fxMode, fxCostPct: s.fxCostPct };
  const std = computeEstimate(input);
  const cau = computeEstimate(cautiousInput(input, s.cautious));
  const { cmax, freeStillShort } = computeCmax(input, s.targetM);
  const obs = data.observations.filter((o) => o.productId === c.productId);
  const stats = computeStats(obs, { condition: c.condition, windowDays: s.researchWindowDays, staleDays: s.staleDays, minComparable: s.minComparable });

  const med = (xs: Decimal[]) => {
    if (!xs.length) return null;
    const a = [...xs].sort((x, y) => x.comparedTo(y));
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : a[m - 1].plus(a[m]).div(2);
  };
  const priceMedian = med(stats.used.map((o) => toDec(o.price)!).filter(Boolean));
  const shipMedian = med(stats.used.map((o) => toDec(o.shipping)).filter((x): x is Decimal => !!x || false));

  const unconfirmed: string[] = [];
  const items = CHECKLISTS[c.checklistCategory] ?? [];
  for (const it of items) {
    const v = c.checks[it];
    if (v === 'ng') unconfirmed.push(it + '（問題あり）');
    else if (v !== 'ok') unconfirmed.push(it);
  }
  const blockers: string[] = [];
  if (c.hardBlocker.trim()) blockers.push(c.hardBlocker.trim());
  const max = toDec(s.maxPerItemJPY);
  const C = toDec(c.price);
  if (max && C && C.gt(max)) blockers.push(`1点あたりの上限（¥${max.toNumber().toLocaleString()}）を超える`);

  const j = judge({
    productConfirmed: c.productConfirmed,
    conditionKnown: c.condition !== 'unknown',
    shippable: draft.shippable,
    standard: std,
    cautious: cau,
    targetM: s.targetM,
    hardBlocker: blockers.join('／'),
    unconfirmedChecks: unconfirmed,
    evidence: { n: stats.n, minComparable: s.minComparable, latestObservedAt: stats.latestObservedAt, staleDays: s.staleDays },
    cmax,
  });
  return { draft, input, std, cau, cmax, freeStillShort, stats, priceMedian, shipMedian, judge: j, unconfirmed, blockers };
}
