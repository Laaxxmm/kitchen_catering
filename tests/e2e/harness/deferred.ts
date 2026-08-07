/**
 * The queue behind the mocked `after()`.
 *
 * Production defers notification fan-out, the auto-proforma and the invoice
 * email until the HTTP response has gone out. There is no response here, so
 * the tasks are started immediately and parked; a test that wants to assert
 * on the fan-out awaits flushDeferred(), and the harness flushes after every
 * test regardless so nothing leaks into the next one's reads.
 *
 * Lives apart from setup.ts because a vi.mock factory may not close over
 * variables in the file it is written in.
 */
const pending: Array<Promise<unknown>> = [];

export function queueDeferred(task: (() => Promise<unknown>) | Promise<unknown>): void {
  pending.push(Promise.resolve(typeof task === "function" ? task() : task));
}

/** Await every deferred task, including any queued by those tasks. */
export async function flushDeferred(): Promise<void> {
  while (pending.length > 0) {
    await Promise.allSettled(pending.splice(0, pending.length));
  }
}
