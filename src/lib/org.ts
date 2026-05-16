/**
 * Organisation-level constants sourced from env with sensible dev defaults.
 * Used by GST math and PDF templates.
 *
 * Function names keep the historical `indefine*` prefix so we don't churn
 * every caller — they're internal identifiers. The displayed company
 * name now defaults to "Green Park Eco Hotel"; override via INDEFINE_*
 * env vars in production if needed.
 */

export function indefineStateCode(): string {
  return process.env.INDEFINE_STATE_CODE ?? "29"; // Karnataka default
}

export function indefineGstin(): string {
  return process.env.INDEFINE_GSTIN ?? "29AAACG0000A1Z5";
}

export function indefineAddress(): string {
  return (
    process.env.INDEFINE_ADDRESS ??
    "Green Park Eco Hotel\nHead Office, Bengaluru, Karnataka"
  );
}

export function indefineBankDetails(): string {
  return (
    process.env.INDEFINE_BANK_DETAILS ??
    "Bank: HDFC Bank\nA/C: 00000000000000\nIFSC: HDFC0000000\nBranch: Bengaluru"
  );
}

export function indefineLogoUrl(): string | undefined {
  return process.env.INDEFINE_LOGO_URL || undefined;
}

export function indefineCompanyName(): string {
  return process.env.INDEFINE_COMPANY_NAME ?? "Green Park Eco Hotel";
}
