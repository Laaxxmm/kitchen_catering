import { after } from "next/server";

/**
 * Run best-effort side-work AFTER the HTTP response is sent.
 *
 * Emails, PDF renders and notification fan-outs used to be awaited at the
 * end of server actions, so every approval/submit button stayed frozen for
 * the SMTP handshake + N notification inserts. Anything passed here runs
 * once the user already has their answer; failures are logged, never
 * surfaced — callers must only defer work whose failure shouldn't undo
 * the committed transaction.
 */
export function deferAfterResponse(label: string, fn: () => Promise<unknown>) {
  after(async () => {
    try {
      await fn();
    } catch (err) {
      console.warn(`[defer] ${label} failed:`, err);
    }
  });
}
