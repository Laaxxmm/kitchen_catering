import { afterEach, beforeAll, vi } from "vitest";
import { flushDeferred } from "./deferred";

/**
 * The three seams between a Next server action and a plain Node process.
 * Everything else — Prisma, the role guards, the Decimal maths, the
 * transactions — runs for real against the kc-e2e database.
 */

// 1. The session. requireRole/requireSession call auth() and nothing else,
//    so this is the whole of "act as a different role".
vi.mock("@/server/auth", async () => {
  const { currentSession } = await import("./session");
  return {
    auth: async () => currentSession(),
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: { GET: async () => undefined, POST: async () => undefined },
  };
});

// 2. Cache invalidation. revalidatePath throws outside a request scope, and
//    an action that had already committed would then return {ok:false} —
//    a green test suite proving nothing.
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
  unstable_cache: <T>(fn: T) => fn,
}));

// 3. after() — same request-scope problem. Here the deferred work is RUN,
//    not dropped: the notification fan-out, the auto-proforma and the
//    invoice email are real behaviour these tests care about.
vi.mock("next/server", async () => {
  const { queueDeferred } = await import("./deferred");
  return { after: queueDeferred };
});

beforeAll(async () => {
  const { ensureSeeded } = await import("./seed");
  await ensureSeeded();
});

afterEach(async () => {
  await flushDeferred();
});
