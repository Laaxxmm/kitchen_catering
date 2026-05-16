import { NextResponse } from "next/server";
import { db } from "@/server/db";

// Lightweight liveness + DB readiness probe used by Railway's healthcheck.
// Returns 200 only when the app can reach the database; 503 otherwise.
//
// Kept intentionally cheap: a single `SELECT 1` over the already-open
// Prisma connection pool. No auth, no business logic, no Prisma model
// resolution — so it stays under a few ms even on a cold container.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json(
      {
        status: "ok",
        db: "up",
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        status: "degraded",
        db: "down",
        error: err instanceof Error ? err.message : "unknown",
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
