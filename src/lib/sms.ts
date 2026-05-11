/**
 * SMS provider abstraction. Phase 1 only had `console.error(...)` in
 * scheduleDelivery. Phase 3 introduces a provider interface so the same
 * call site works against MSG91 in production and console in dev.
 *
 * Selection priority:
 *   1. env SMS_PROVIDER=msg91 + MSG91_AUTHKEY set → MSG91
 *   2. anything else → console (logs the OTP for the dispatcher to read)
 */

export interface SMSProvider {
  send(to: string, message: string): Promise<{ messageId: string }>;
}

class ConsoleSMSProvider implements SMSProvider {
  async send(to: string, message: string) {
    // SECURITY.md §11: structured server log; not a PII leak in dev since
    // the dispatcher needs to see it to share with the recipient.
    console.error(`[SMS to ${to}] ${message}`);
    return { messageId: `console-${Date.now()}` };
  }
}

class MSG91Provider implements SMSProvider {
  private authkey: string;

  constructor() {
    const k = process.env.MSG91_AUTHKEY;
    if (!k) throw new Error("MSG91_AUTHKEY not set");
    this.authkey = k;
  }

  async send(to: string, message: string) {
    // MSG91 V5 send-SMS API. The plan is DLT-template OTP; real product
    // deployment will use a pre-approved template ID and substitute
    // variables instead of a free-form body. Stubbed here as a guarded
    // fetch so credentials in the wild don't get blasted at MSG91 from
    // tests.
    const senderId = process.env.MSG91_SENDER_ID ?? "INDKTC";
    const url = "https://control.msg91.com/api/v5/flow/";
    const body = {
      sender: senderId,
      route: "4", // transactional
      country: "91",
      sms: [{ message, to: [to] }],
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: this.authkey,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`MSG91 send failed: ${resp.status} ${text.slice(0, 200)}`);
    }
    const data = (await resp.json()) as { request_id?: string };
    return { messageId: data.request_id ?? `msg91-${Date.now()}` };
  }
}

let cached: SMSProvider | null = null;

export function getSMSProvider(): SMSProvider {
  if (cached) return cached;
  const provider = (process.env.SMS_PROVIDER ?? "console").toLowerCase();
  if (provider === "msg91" && process.env.MSG91_AUTHKEY) {
    cached = new MSG91Provider();
  } else {
    cached = new ConsoleSMSProvider();
  }
  return cached;
}

/** Format a friendly OTP SMS body. */
export function formatOTPMessage(otp: string, orderCode?: string): string {
  return `Indefine Kitchen: your delivery OTP is ${otp}${orderCode ? ` for order ${orderCode}` : ""}. Do not share. Valid for one delivery only.`;
}
