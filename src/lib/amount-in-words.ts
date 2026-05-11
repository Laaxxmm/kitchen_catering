import { Decimal } from "decimal.js";
import { toDecimal } from "./money";

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] ?? "";
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? TENS[t] : `${TENS[t]} ${ONES[o]}`;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(`${ONES[h]} Hundred`);
  if (rest > 0) parts.push(twoDigits(rest));
  return parts.join(" ");
}

/** Indian numbering: lakh = 1e5, crore = 1e7. */
function integerToWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1_00_00_000);
  n = n % 1_00_00_000;
  const lakh = Math.floor(n / 1_00_000);
  n = n % 1_00_000;
  const thousand = Math.floor(n / 1_000);
  n = n % 1_000;
  const hundreds = n;

  if (crore > 0) parts.push(`${integerToWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundreds > 0) parts.push(threeDigits(hundreds));
  return parts.join(" ");
}

/**
 * "Rupees One Lakh Nineteen Thousand One Hundred Only"
 * or "Rupees Two and Fifty Paise Only" for sub-rupee-only amounts.
 */
export function amountInWords(amount: Decimal | number | string): string {
  const d = toDecimal(amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const rupees = d.floor().toNumber();
  const paise = d.minus(d.floor()).times(100).round().toNumber();

  const rupeeWords = integerToWords(rupees);

  if (paise === 0) {
    return `Rupees ${rupeeWords} Only`;
  }
  const paiseWords = twoDigits(paise);
  if (rupees === 0) {
    return `Rupees Zero and ${paiseWords} Paise Only`;
  }
  return `Rupees ${rupeeWords} and ${paiseWords} Paise Only`;
}
