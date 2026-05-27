import { NextResponse, type NextRequest } from "next/server";
import { runVendorPaymentRemindersInternal } from "@/server/actions/reminders";

// Cron endpoint for the 3-day vendor payment reminder job.
//
// Auth model: a shared secret in the `Authorization: Bearer <token>`
// header, compared to env `CRON_SECRET`. Railway-style cron services
// can hit this URL with the secret to fire the job daily.
//
// Falls back to refusing the call when CRON_SECRET isn't set, so we
// don't accidentally expose a public-runner endpoint in misconfigured
// environments.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on the server" },
      { status: 503 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runVendorPaymentRemindersInternal();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}

// Allow POST too — some cron providers use POST. Same logic.
export const POST = GET;
