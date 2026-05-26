import nodemailer, { type Transporter } from "nodemailer";

/**
 * Email provider abstraction. Two modes:
 *   1. SMTP (production)  — requires SMTP_HOST + SMTP_USER + SMTP_PASS in env.
 *      Default tuned for Outlook / Office 365:
 *        SMTP_HOST=smtp.office365.com
 *        SMTP_PORT=587
 *        SMTP_USER=ops@greenpath.in
 *        SMTP_PASS=<outlook app password>
 *        EMAIL_FROM="Greenpath <ops@greenpath.in>"
 *
 *   2. Console (dev)      — when SMTP_HOST / SMTP_USER aren't set, logs the
 *      message to stderr instead of sending. Useful for local dev.
 *
 * One sender per process; cached transport.
 */

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
  cc?: string | string[];
  replyTo?: string;
}

export interface EmailSendResult {
  messageId: string;
  provider: "smtp" | "console";
  accepted?: string[];
  rejected?: string[];
}

let cachedTransport: Transporter | null = null;
let cachedMode: "smtp" | "console" | null = null;

function detectMode(): "smtp" | "console" {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  return host && user && pass ? "smtp" : "console";
}

function getTransport(): Transporter | null {
  const mode = detectMode();
  if (mode === "console") return null;
  if (cachedTransport && cachedMode === mode) return cachedTransport;
  cachedMode = mode;
  const host = process.env.SMTP_HOST ?? "smtp.office365.com";
  const port = Number(process.env.SMTP_PORT ?? "587");
  // Office 365 + Outlook need STARTTLS on 587, not implicit TLS on 465.
  const secure = port === 465;
  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
    // O365 sometimes wants this; harmless elsewhere.
    requireTLS: !secure,
    tls: { ciphers: "TLSv1.2" },
  });
  return cachedTransport;
}

function emailFrom(): string {
  return (
    process.env.EMAIL_FROM ??
    (process.env.SMTP_USER ? `Greenpath <${process.env.SMTP_USER}>` : "Greenpath <no-reply@localhost>")
  );
}

export async function sendEmail(input: SendEmailInput): Promise<EmailSendResult> {
  const transport = getTransport();
  if (!transport) {
    // Console mode — log a structured preview for the dispatcher to read.
    const to = Array.isArray(input.to) ? input.to.join(", ") : input.to;
    console.error(
      `[EMAIL (console)] to=${to} subject="${input.subject}" attachments=${input.attachments?.length ?? 0}`,
    );
    if (process.env.EMAIL_LOG_BODY === "1") {
      console.error(`[EMAIL body] ${input.text}`);
    }
    return { messageId: `console-${Date.now()}`, provider: "console" };
  }

  const info = await transport.sendMail({
    from: emailFrom(),
    to: input.to,
    cc: input.cc,
    replyTo: input.replyTo,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.attachments,
  });

  return {
    messageId: info.messageId,
    provider: "smtp",
    accepted: (info.accepted ?? []).map(String),
    rejected: (info.rejected ?? []).map(String),
  };
}

/** Composer for invoice emails (proforma or final). */
export function buildInvoiceEmail(input: {
  invoiceNo: string;
  invoiceKind: "PROFORMA" | "ORDER" | "ADHOC" | "ADVANCE" | "CREDIT_NOTE";
  customerName: string;
  grandTotal: string;
  eventDateLabel?: string;
  publicUrl: string;
}): { subject: string; text: string; html: string } {
  const kindLabel = input.invoiceKind === "PROFORMA" ? "Proforma invoice" : "Tax invoice";
  const subject = `${kindLabel} ${input.invoiceNo} from Greenpath`;
  const text =
    `Hi ${input.customerName},\n\n` +
    `Please find your ${kindLabel.toLowerCase()} from Greenpath attached.\n\n` +
    `Invoice no:  ${input.invoiceNo}\n` +
    `Amount:      ${input.grandTotal}\n` +
    (input.eventDateLabel ? `For event on: ${input.eventDateLabel}\n` : "") +
    `\nYou can also view the invoice online at:\n${input.publicUrl}\n\n` +
    `Thank you,\nGreenpath\n`;
  const html = `
<div style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color:#1F2A24; line-height:1.5;">
  <p>Hi ${escapeHtml(input.customerName)},</p>
  <p>Please find your <strong>${escapeHtml(kindLabel.toLowerCase())}</strong> from Greenpath attached.</p>
  <table style="border-collapse:collapse; margin:12px 0;">
    <tr><td style="padding:4px 12px 4px 0; color:#516056;">Invoice no</td><td style="font-family:monospace;">${escapeHtml(input.invoiceNo)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0; color:#516056;">Amount</td><td style="font-weight:600;">${escapeHtml(input.grandTotal)}</td></tr>
    ${input.eventDateLabel ? `<tr><td style="padding:4px 12px 4px 0; color:#516056;">Event date</td><td>${escapeHtml(input.eventDateLabel)}</td></tr>` : ""}
  </table>
  <p>You can also view the invoice online here: <a href="${escapeHtml(input.publicUrl)}" style="color:#0F6E56;">View invoice</a>.</p>
  <p style="color:#516056; font-size: 13px;">Thank you,<br/>Greenpath</p>
</div>`.trim();
  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c] as string));
}

/**
 * Composer for quote emails. Sent both when the user clicks "Send to
 * customer" for the first time and again whenever they hit "Resend by
 * email" after a revision. The body intentionally avoids price detail
 * so the customer always clicks through to the live share link.
 */
export function buildQuoteEmail(input: {
  quoteNo: string;
  customerName: string;
  title: string;
  grandTotal: string;
  eventDateLabel?: string;
  validUntilLabel?: string;
  publicUrl: string;
  notes?: string | null;
}): { subject: string; text: string; html: string } {
  const subject = `Quote ${input.quoteNo} from Greenpath`;
  const text =
    `Hi ${input.customerName},\n\n` +
    `Please find your quote — "${input.title}" — from Greenpath.\n\n` +
    `Quote no:    ${input.quoteNo}\n` +
    `Amount:      ${input.grandTotal}\n` +
    (input.eventDateLabel ? `Event date:  ${input.eventDateLabel}\n` : "") +
    (input.validUntilLabel ? `Valid until: ${input.validUntilLabel}\n` : "") +
    `\nView the full quote here:\n${input.publicUrl}\n\n` +
    (input.notes ? `Notes from us:\n${input.notes}\n\n` : "") +
    `Reply to this email or call us if you'd like to change anything — menu, dates, headcount, ` +
    `whatever. We can revise the quote any time before you accept.\n\n` +
    `Thank you,\nGreenpath\n`;
  const html = `
<div style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color:#1F2A24; line-height:1.5;">
  <p>Hi ${escapeHtml(input.customerName)},</p>
  <p>Please find your quote — <strong>${escapeHtml(input.title)}</strong> — from Greenpath.</p>
  <table style="border-collapse:collapse; margin:12px 0;">
    <tr><td style="padding:4px 12px 4px 0; color:#516056;">Quote no</td><td style="font-family:monospace;">${escapeHtml(input.quoteNo)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0; color:#516056;">Amount</td><td style="font-weight:600;">${escapeHtml(input.grandTotal)}</td></tr>
    ${input.eventDateLabel ? `<tr><td style="padding:4px 12px 4px 0; color:#516056;">Event date</td><td>${escapeHtml(input.eventDateLabel)}</td></tr>` : ""}
    ${input.validUntilLabel ? `<tr><td style="padding:4px 12px 4px 0; color:#516056;">Valid until</td><td>${escapeHtml(input.validUntilLabel)}</td></tr>` : ""}
  </table>
  <p>
    <a href="${escapeHtml(input.publicUrl)}" style="display:inline-block; background:#0F6E56; color:#fff; padding:10px 18px; border-radius:6px; text-decoration:none; font-weight:500;">
      View the full quote
    </a>
  </p>
  ${input.notes ? `<p style="color:#516056; border-left:3px solid #C8EBDD; padding-left:12px; margin:16px 0;">${escapeHtml(input.notes).replace(/\n/g, "<br/>")}</p>` : ""}
  <p style="color:#516056; font-size:13px;">
    Reply to this email or call us if you'd like to change anything — menu, dates, headcount,
    whatever. We can revise the quote any time before you accept.
  </p>
  <p style="color:#516056; font-size: 13px;">Thank you,<br/>Greenpath</p>
</div>`.trim();
  return { subject, text, html };
}
