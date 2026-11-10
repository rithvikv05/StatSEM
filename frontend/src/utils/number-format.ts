/**
 * Shared statistical number formatting and rounding utilities.
 *
 * Implements decimal half-away-from-zero rounding via exponential digit strings
 * so IEEE-754 binary64 `.toFixed()` tie glitches (e.g. `(1.005).toFixed(2)`)
 * and negative zero (`"-0.0000"`) artifacts do not occur.
 */

export type DecimalSystem = 'point' | 'comma';

export const MIN_DECIMAL_DIGITS = 2;
export const MAX_DECIMAL_DIGITS = 7;
export const DEFAULT_DECIMAL_DIGITS = 4;

/**
 * Clamp and normalize the user's configured decimal digit setting into [2, 7].
 */
export function normalizeDecimalDigits(digits: unknown): number {
  if (typeof digits !== 'number' || !Number.isFinite(digits)) {
    return DEFAULT_DECIMAL_DIGITS;
  }
  const truncated = Math.trunc(digits);
  return Math.min(MAX_DECIMAL_DIGITS, Math.max(MIN_DECIMAL_DIGITS, truncated));
}

function getDecimalSeparator(decimalSystem?: DecimalSystem): '.' | ',' {
  return decimalSystem === 'comma' ? ',' : '.';
}

function resolveRequestedDecimals(decimals?: number | null): number {
  if (decimals === undefined || decimals === null || !Number.isFinite(decimals)) {
    return DEFAULT_DECIMAL_DIGITS;
  }
  return Math.min(20, Math.max(0, Math.trunc(decimals)));
}

/**
 * Parse a numeric input if it represents a finite number (rejecting booleans,
 * empty/whitespace strings, NaN, and Infinity).
 */
export function toFiniteNumber(val: unknown): number | null {
  if (val === undefined || val === null || typeof val === 'boolean' || typeof val === 'symbol') {
    return null;
  }
  if (typeof val === 'string' && val.trim() === '') {
    return null;
  }
  const num = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(num) ? num : null;
}

/**
 * Format a numeric value to `decimals` digits after the decimal separator
 * using decimal half-away-from-zero rounding and suppressing `"-0"`.
 */
export function formatNumber(
  val: unknown,
  decimals: number = DEFAULT_DECIMAL_DIGITS,
  decimalSystem: DecimalSystem = 'point'
): string {
  const num = toFiniteNumber(val);
  if (num === null) {
    return '—';
  }

  const d = resolveRequestedDecimals(decimals);
  const sep = getDecimalSeparator(decimalSystem);
  const zeroSuffix = d > 0 ? `${sep}${'0'.repeat(d)}` : '';

  if (num === 0) {
    return `0${zeroSuffix}`;
  }

  const isNegative = num < 0;
  const abs = Math.abs(num);
  const [mantissa, expStr] = abs.toExponential().split('e');
  const exp = parseInt(expStr, 10);

  // Fallback for astronomical numbers beyond standard fixed-decimal display range.
  if (exp >= 21) {
    const expFormatted = abs.toExponential(d);
    const withSep = sep === ',' ? expFormatted.replace('.', ',') : expFormatted;
    return isNegative ? `-${withSep}` : withSep;
  }

  // Last kept digit index in rawDigits corresponds to place value 10^(-d).
  const k = exp + d;
  if (k < -1) {
    return `0${zeroSuffix}`;
  }

  const rawDigits = mantissa.replace('.', '');
  const keptCount = k + 1;
  const digitAt = (idx: number): number =>
    idx < rawDigits.length ? rawDigits.charCodeAt(idx) - 48 : 0;

  const digits: number[] = new Array(keptCount);
  for (let i = 0; i < keptCount; i += 1) {
    digits[i] = digitAt(i);
  }

  // Half away from zero: round up whenever first discarded digit >= 5.
  if (digitAt(keptCount) >= 5) {
    let carry = 1;
    for (let i = digits.length - 1; i >= 0 && carry > 0; i -= 1) {
      const sum = digits[i] + carry;
      if (sum >= 10) {
        digits[i] = sum - 10;
        carry = 1;
      } else {
        digits[i] = sum;
        carry = 0;
      }
    }
    if (carry > 0) {
      digits.unshift(carry);
    }
  }

  const allZero = digits.every((digit) => digit === 0);
  if (allZero) {
    return `0${zeroSuffix}`;
  }

  while (digits.length < d + 1) {
    digits.unshift(0);
  }

  const splitIdx = digits.length - d;
  const intPart = digits.slice(0, splitIdx).join('');
  const fracPart = d > 0 ? digits.slice(splitIdx).join('') : '';
  const sign = isNegative ? '-' : '';

  return d > 0 ? `${sign}${intPart}${sep}${fracPart}` : `${sign}${intPart}`;
}

/**
 * Format a p-value with dynamic precision threshold `< 10^(-decimals)` so
 * small p-values remain visible up to the selected decimal precision.
 */
export function formatPValue(
  val: unknown,
  decimals: number = DEFAULT_DECIMAL_DIGITS,
  decimalSystem: DecimalSystem = 'point'
): string {
  const num = toFiniteNumber(val);
  if (num === null) {
    return '—';
  }

  const d = resolveRequestedDecimals(decimals);
  const sep = getDecimalSeparator(decimalSystem);
  const threshold = Number(`1e-${d}`);

  if (num >= 0 && num < threshold) {
    if (d === 0) {
      return '< 1';
    }
    return `< 0${sep}${'0'.repeat(d - 1)}1`;
  }

  return formatNumber(num, d, decimalSystem);
}

