// バーコードの正規化とチェックデジット検証。コードは常に文字列で扱い、先頭ゼロを維持する。

export type CodeType = 'EAN-13' | 'EAN-8' | 'UPC-A' | 'STORE' | 'UNKNOWN';

export interface ParsedCode {
  raw: string; // 読み取ったままの原コード
  digits: string; // 空白・ハイフン除去後
  normalized: string; // 照合用（UPC-A は先頭0付き13桁=GTIN-13）
  type: CodeType;
  checkDigitValid: boolean | null; // 桁数不明なら null
  storeInternal: boolean; // 店舗内コード（JAN 20〜29 始まり等）の可能性
}

/** GTIN 系の汎用チェックデジット計算（最後の桁を除いた数字列に対して） */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  // 右端（チェックデジットの隣）から 3,1,3,1...
  for (let i = 0; i < body.length; i++) {
    const n = body.charCodeAt(body.length - 1 - i) - 48;
    sum += i % 2 === 0 ? n * 3 : n;
  }
  return (10 - (sum % 10)) % 10;
}

export function validGtin(digits: string): boolean {
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return false;
  return gtinCheckDigit(digits.slice(0, -1)) === digits.charCodeAt(digits.length - 1) - 48;
}

export function parseCode(raw: string): ParsedCode {
  const digits = String(raw).replace(/[\s-]/g, '');
  const base = { raw: String(raw), digits };
  if (!/^\d+$/.test(digits)) {
    return { ...base, normalized: digits, type: 'UNKNOWN', checkDigitValid: null, storeInternal: false };
  }
  if (digits.length === 13) {
    const p2 = Number(digits.slice(0, 2));
    const store = p2 >= 20 && p2 <= 29; // インストアマーキング（店舗内・非流通コード）
    return {
      ...base,
      normalized: digits,
      type: store ? 'STORE' : 'EAN-13',
      checkDigitValid: validGtin(digits),
      storeInternal: store,
    };
  }
  if (digits.length === 12) {
    const store = digits[0] === '2' || digits[0] === '4';
    return {
      ...base,
      normalized: '0' + digits,
      type: store ? 'STORE' : 'UPC-A',
      checkDigitValid: validGtin(digits),
      storeInternal: store,
    };
  }
  if (digits.length === 8) {
    const store = digits[0] === '2';
    return { ...base, normalized: digits, type: store ? 'STORE' : 'EAN-8', checkDigitValid: validGtin(digits), storeInternal: store };
  }
  return { ...base, normalized: digits, type: 'UNKNOWN', checkDigitValid: null, storeInternal: false };
}

/** 連続検出の重複を抑える。同じ正規化コードを cooldownMs 以内に再通知しない。 */
export function makeDeduper(cooldownMs = 2500) {
  let last = '';
  let at = 0;
  return (normalized: string, now = Date.now()): boolean => {
    if (normalized === last && now - at < cooldownMs) return false;
    last = normalized;
    at = now;
    return true;
  };
}
