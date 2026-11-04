import { describe, it, expect } from 'vitest';
import { computeEstimate, computeCmax, cautiousInput, computeActual, type EstimateInput } from '../src/core/money';
import { parseCode, validGtin, makeDeduper } from '../src/core/barcode';
import { computeStats } from '../src/core/stats';
import { judge } from '../src/core/judge';
import type { MarketObservation } from '../src/core/types';

const base: EstimateInput = {
  P: '40', S: '10', T: null, currency: 'USD', r: '150',
  fxMode: 'inRate', fxCostPct: null,
  fee: { mode: 'manual', amountJPY: '1200', isEstimate: false },
  C: '3000', D: '200', Afixed: '0', AratePct: null, R: '0', I: '1500', K: '100', U: '0', Q: '300',
};

describe('受入テスト5・6：利益計算と仕入れ上限', () => {
  it('予想残額は1200円', () => {
    const r = computeEstimate(base);
    expect(r.complete).toBe(true);
    expect(r.E!.toString()).toBe('1200');
  });
  it('目標2000円なら仕入れ上限2200円', () => {
    expect(computeCmax(base, '2000').cmax!.toString()).toBe('2200');
  });
  it('P=36・F固定の慎重ケースは600円', () => {
    expect(computeEstimate({ ...base, P: '36' }).E!.toString()).toBe('600');
  });
  it('慎重シナリオ生成：料率型手数料は再計算される', () => {
    const inp: EstimateInput = { ...base, fee: { mode: 'profile', ratePct: '10', fixedPerOrder: '0', baseIncludesShipping: true, baseIncludesTax: false, isEstimate: false } };
    const std = computeEstimate(inp);
    const cau = computeEstimate(cautiousInput(inp, { priceDropPct: '10', yenStrongPct: '0', shippingIncreasePct: '0' }));
    // 標準: (50)*0.1*150=750 / 慎重: (36+10)*0.1*150=690
    expect(std.breakdown!.feeJPY.toString()).toBe('750');
    expect(cau.breakdown!.feeJPY.toString()).toBe('690');
  });
  it('無料でも目標未達なら負の上限', () => {
    const r = computeCmax(base, '10000');
    expect(r.freeStillShort).toBe(true);
    expect(r.cmax!.isNegative()).toBe(true);
  });
  it('購入金額比例の費用がある場合も同じ関数で解く', () => {
    const inp = { ...base, AratePct: '10' };
    const { cmax } = computeCmax(inp, '2000');
    // E(C)=4500-1.1C-... 確認：E(cmax)>=2000 かつ E(cmax+1)<2000
    expect(computeEstimate({ ...inp, C: cmax!.toString() }).E!.gte(2000)).toBe(true);
    expect(computeEstimate({ ...inp, C: cmax!.plus(1).toString() }).E!.lt(2000)).toBe(true);
  });
  it('利益率の分母0は算出不可', () => {
    expect(computeEstimate({ ...base, P: '0', S: '0' }).marginPct).toBeNull();
  });
});

describe('受入テスト4：未入力と0の区別', () => {
  it('未入力は不足として列挙、0は確定値', () => {
    const r = computeEstimate({ ...base, I: null, U: '0' });
    expect(r.complete).toBe(false);
    expect(r.missing).toContain('国際送料');
    expect(r.missing).not.toContain('関税等（売り手負担）');
  });
  it('不足時は判定不能', () => {
    const std = computeEstimate({ ...base, I: null });
    const j = judge({ productConfirmed: true, conditionKnown: true, shippable: 'yes', standard: std, cautious: std, targetM: '1000', hardBlocker: '', unconfirmedChecks: [], evidence: { n: 10, minComparable: 5, latestObservedAt: new Date().toISOString(), staleDays: 30 } });
    expect(j.verdict).toBe('undetermined');
  });
});

describe('受入テスト7・8：税・為替の二重計上防止', () => {
  const prof = { mode: 'profile' as const, ratePct: '10', fixedPerOrder: '0', baseIncludesShipping: true, baseIncludesTax: true, isEstimate: false };
  it('Tは売上に加えず、手数料だけ変わる', () => {
    const a = computeEstimate({ ...base, fee: prof, T: '0' });
    const b = computeEstimate({ ...base, fee: prof, T: '5' });
    expect(a.breakdown!.revenueJPY.toString()).toBe(b.breakdown!.revenueJPY.toString());
    expect(b.breakdown!.feeJPY.minus(a.breakdown!.feeJPY).toString()).toBe('75');
  });
  it('T不明で課金対象なら概算表示', () => {
    expect(computeEstimate({ ...base, fee: prof, T: null }).approxReasons.length).toBeGreaterThan(0);
  });
  it('為替費用：inRateモードでは別計上しない', () => {
    const a = computeEstimate({ ...base, fxMode: 'inRate', fxCostPct: '3' });
    expect(a.breakdown!.fxCostJPY.toString()).toBe('0');
    const b = computeEstimate({ ...base, fxMode: 'separate', fxCostPct: '2' });
    expect(b.breakdown!.fxCostJPY.toString()).toBe('150');
    expect(b.E!.toString()).toBe('1050');
  });
  it('控除後入金では手数料を再控除せず、予備費は実績に入らない', () => {
    const net = computeActual({ mode: 'net', grossJPY: null, feesJPY: '1200', netPayoutJPY: '6300', refundsJPY: null, costsJPY: ['3000', '200', '1500', '100'] });
    expect(net.value!.toString()).toBe('1500');
    const gross = computeActual({ mode: 'gross', grossJPY: '7500', feesJPY: '1200', netPayoutJPY: null, refundsJPY: '0', costsJPY: ['3000', '200', '1500', '100'] });
    expect(gross.value!.toString()).toBe('1500');
  });
  it('返金は実績から差し引く', () => {
    const v = computeActual({ mode: 'net', grossJPY: null, feesJPY: null, netPayoutJPY: '6300', refundsJPY: '6300', costsJPY: ['3000'] });
    expect(v.value!.toString()).toBe('-3000');
  });
});

describe('受入テスト1・2：バーコード', () => {
  it('JANのチェックデジット', () => {
    expect(validGtin('4902370536485')).toBe(true);
    expect(validGtin('4902370536486')).toBe(false);
  });
  it('先頭ゼロを保持し、UPC-AはGTIN-13へ正規化', () => {
    const p = parseCode('045496590420');
    expect(p.type).toBe('UPC-A');
    expect(p.raw).toBe('045496590420');
    expect(p.normalized).toBe('0045496590420');
    expect(p.checkDigitValid).toBe(true);
  });
  it('EAN-8', () => {
    const p = parseCode('49123456');
    expect(p.type).toBe('EAN-8');
    expect(p.checkDigitValid).toBe(true);
  });
  it('店舗内コード（20〜29始まり）を区別', () => {
    expect(parseCode('2000000000008').storeInternal).toBe(true);
  });
  it('連続検出の重複を抑える', () => {
    const d = makeDeduper(2000);
    expect(d('1', 0)).toBe(true);
    expect(d('1', 500)).toBe(false);
    expect(d('1', 2600)).toBe(true);
  });
});

function obs(p: Partial<MarketObservation>): MarketObservation {
  const now = new Date().toISOString();
  return { id: Math.random().toString(36), createdAt: now, updatedAt: now, productId: 'p', condition: 'used_complete', kind: 'sold', url: '', source: 'eBay', observedAt: now, soldAt: now, currency: 'USD', price: '40', shipping: '10', region: '', accessories: '', isLot: false, adopted: true, excludeReason: '', note: '', ...p };
}

describe('受入テスト9・10：統計と判定', () => {
  const opts = { condition: 'used_complete' as const, windowDays: 90, staleDays: 30, minComparable: 5 };
  it('ジャンク・まとめ売り・除外を外して再計算', () => {
    const list = [obs({ price: '40', url: 'a' }), obs({ price: '50', url: 'b' }), obs({ price: '5', condition: 'junk' }), obs({ price: '100', isLot: true }), obs({ price: '60', adopted: false, excludeReason: '別地域' })];
    const s = computeStats(list, opts);
    expect(s.n).toBe(2);
    expect(s.median!.toString()).toBe('55');
    expect(s.excluded.map((e) => e.reason)).toEqual(expect.arrayContaining(['状態が異なる', 'まとめ売り', '別地域']));
    expect(s.warnings.join()).toContain('少数');
  });
  it('同一成約の重複を除外', () => {
    const s = computeStats([obs({ url: 'x' }), obs({ url: 'x' })], opts);
    expect(s.n).toBe(1);
  });
  it('古い・少ない相場は条件付き', () => {
    const std = computeEstimate(base);
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    const j = judge({ productConfirmed: true, conditionKnown: true, shippable: 'yes', standard: std, cautious: std, targetM: '1000', hardBlocker: '', unconfirmedChecks: [], evidence: { n: 2, minComparable: 5, latestObservedAt: old, staleDays: 30 } });
    expect(j.verdict).toBe('conditional');
  });
  it('標準・慎重とも達成で仕入れ候補、目標未設定なら推奨を出さない', () => {
    const std = computeEstimate(base);
    const ev = { n: 6, minComparable: 5, latestObservedAt: new Date().toISOString(), staleDays: 30 };
    expect(judge({ productConfirmed: true, conditionKnown: true, shippable: 'yes', standard: std, cautious: std, targetM: '1000', hardBlocker: '', unconfirmedChecks: [], evidence: ev }).verdict).toBe('candidate');
    expect(judge({ productConfirmed: true, conditionKnown: true, shippable: 'yes', standard: std, cautious: std, targetM: null, hardBlocker: '', unconfirmedChecks: [], evidence: ev }).verdict).toBe('undetermined');
  });
  it('状態不明では緑（候補）にならない', () => {
    const std = computeEstimate(base);
    const ev = { n: 6, minComparable: 5, latestObservedAt: new Date().toISOString(), staleDays: 30 };
    expect(judge({ productConfirmed: true, conditionKnown: false, shippable: 'yes', standard: std, cautious: std, targetM: '1000', hardBlocker: '', unconfirmedChecks: [], evidence: ev }).verdict).toBe('conditional');
  });
  it('配送不可・目標未達は見送り', () => {
    const std = computeEstimate(base);
    const ev = { n: 6, minComparable: 5, latestObservedAt: new Date().toISOString(), staleDays: 30 };
    expect(judge({ productConfirmed: true, conditionKnown: true, shippable: 'no', standard: std, cautious: std, targetM: '1000', hardBlocker: '', unconfirmedChecks: [], evidence: ev }).verdict).toBe('pass');
    expect(judge({ productConfirmed: true, conditionKnown: true, shippable: 'yes', standard: std, cautious: std, targetM: '5000', hardBlocker: '', unconfirmedChecks: [], evidence: ev }).verdict).toBe('pass');
  });
});
