// 判定ルール。優先順：判定不能 → 見送り → 条件付き → 仕入れ候補。
import type Decimal from 'decimal.js';
import type { Verdict } from './types';
import { toDec, yen, type Num, type EstimateResult } from './money';

export interface JudgeInput {
  productConfirmed: boolean;
  conditionKnown: boolean;
  shippable: 'yes' | 'no' | 'unknown';
  standard: EstimateResult;
  cautious: EstimateResult;
  targetM: Num;
  hardBlocker: string;
  unconfirmedChecks: string[]; // 未確認の動作・付属品など
  evidence: { n: number; minComparable: number; latestObservedAt: string | null; staleDays: number };
  cmax?: Decimal | null;
  now?: Date;
}

export interface JudgeResult {
  verdict: Verdict;
  reasons: string[];
}

export function judge(j: JudgeInput): JudgeResult {
  const now = j.now ?? new Date();
  const reasons: string[] = [];

  // 1. 判定できない
  const undet: string[] = [];
  if (!j.productConfirmed) undet.push('商品の同定が未確定');
  if (!j.standard.complete) undet.push('未入力：' + j.standard.missing.join('、'));
  if (j.shippable === 'unknown') undet.push('配送可否・送料が未確認');
  const M = toDec(j.targetM);
  if (undet.length) return { verdict: 'undetermined', reasons: undet };

  // 2. 見送り
  const pass: string[] = [];
  if (j.shippable === 'no') pass.push('配送不可');
  if (j.hardBlocker.trim()) pass.push('取扱不可理由：' + j.hardBlocker.trim());
  if (M && j.standard.E && j.standard.E.lt(M)) pass.push(`標準シナリオの予想残額 ${yen(j.standard.E)} が目標 ${yen(M)} を下回る`);
  if (j.cmax && j.cmax.isNegative()) pass.push(`無料で仕入れても目標未達（仕入れ上限 ${yen(j.cmax)}）`);
  if (pass.length) return { verdict: 'pass', reasons: pass };

  if (!M) return { verdict: 'undetermined', reasons: ['目標残額が未設定のため計算のみ表示（設定で入力すると判定します）'] };

  // 3. 条件付き
  const cond: string[] = [];
  if (!j.cautious.complete || !j.cautious.E) cond.push('慎重シナリオを計算できない');
  else if (j.cautious.E.lt(M)) cond.push(`慎重シナリオでは ${yen(j.cautious.E)} で目標未達`);
  if (!j.conditionKnown) cond.push('状態が不明');
  if (j.unconfirmedChecks.length) cond.push('未確認：' + j.unconfirmedChecks.join('、'));
  if (j.evidence.n < j.evidence.minComparable) cond.push(`比較可能な成約例が少数（${j.evidence.n}件）`);
  if (!j.evidence.latestObservedAt) cond.push('相場の根拠がない');
  else if (now.getTime() - new Date(j.evidence.latestObservedAt).getTime() > j.evidence.staleDays * 86400000) {
    cond.push(`相場の確認日が${j.evidence.staleDays}日より古い`);
  }
  if (j.standard.approxReasons.length) cond.push('概算：' + j.standard.approxReasons.join('、'));
  if (cond.length) return { verdict: 'conditional', reasons: cond };

  reasons.push('標準・慎重シナリオとも目標を達成し、必要な確認が済んでいる');
  return { verdict: 'candidate', reasons };
}
