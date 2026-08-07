"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isNextNavigationError } from "@/lib/next-error";
import { recordBanquetReturn } from "@/server/actions/banquet";

export interface BanquetLedgerRow {
  itemId: string;
  name: string;
  unit: string;
  issued: string;
  returned: string;
  outstanding: string;
}

function nowLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

/**
 * Order-wise F&B store return: what went out to this event, what came back,
 * what's still out, and the boxes to book the rest back in. Covers every
 * banquet item issued to the order — cutlery, disposables, arrangements —
 * not just plates.
 *
 * Shared by the delivery team's event-prep screen and the F&B store's own
 * returns route so both record the identical movement. The server caps each
 * line at what's still out for the order (recordBanquetReturn); the input's
 * max is a courtesy, not the guard.
 */
export function BanquetReturnPanel({
  orderId,
  ledger,
}: {
  orderId: string;
  ledger: BanquetLedgerRow[];
}) {
  const router = useRouter();
  const [returning, startReturn] = useTransition();
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});

  if (ledger.length === 0) return null;
  const anyOutstanding = ledger.some((r) => Number(r.outstanding) > 0);

  function recordReturns() {
    const entries = Object.entries(returnQty)
      .map(([itemId, q]) => ({ itemId, quantity: q.trim() }))
      .filter((e) => e.quantity && Number(e.quantity) > 0);
    if (entries.length === 0) return toast.error("Enter how many pieces came back");
    startReturn(async () => {
      try {
        const res = await recordBanquetReturn({
          returnedAt: nowLocal(),
          orderId,
          notes: null,
          lines: entries,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Return recorded — stock updated");
        setReturnQty({});
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not record the return");
      }
    });
  }

  return (
    <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12px] font-medium text-ik-ink-2">
          F&amp;B store items out with this client
        </div>
        {anyOutstanding ? (
          <span className="rounded-full bg-amber-wash px-2 py-0.5 text-[10.5px] font-medium text-amber-700">
            Balance outstanding — chargeable to the client / handler
          </span>
        ) : (
          <span className="rounded-full bg-positive/10 px-2 py-0.5 text-[10.5px] font-medium text-positive">
            All returned
          </span>
        )}
      </div>
      <table className="w-full text-[12.5px]">
        <thead className="border-b border-ik-rule text-left text-ik-ink-3">
          <tr>
            <th className="py-1 pr-2">Item</th>
            <th className="w-20 py-1 pr-2 text-right">Went out</th>
            <th className="w-20 py-1 pr-2 text-right">Came back</th>
            <th className="w-20 py-1 pr-2 text-right">Still out</th>
            <th className="w-28 py-1 pr-2 text-right">Return now</th>
          </tr>
        </thead>
        <tbody>
          {ledger.map((r) => (
            <tr key={r.itemId} className="border-b border-ik-rule/60">
              <td className="py-1.5 pr-2">{r.name}</td>
              <td className="py-1.5 pr-2 text-right font-mono">{r.issued}</td>
              <td className="py-1.5 pr-2 text-right font-mono">{r.returned}</td>
              <td
                className={
                  "py-1.5 pr-2 text-right font-mono " +
                  (Number(r.outstanding) > 0 ? "font-semibold text-amber-700" : "text-ik-ink-3")
                }
              >
                {r.outstanding}
              </td>
              <td className="py-1 pr-2">
                {Number(r.outstanding) > 0 ? (
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    max={r.outstanding}
                    placeholder="0"
                    className="h-8 text-right font-mono"
                    value={returnQty[r.itemId] ?? ""}
                    onChange={(e) => setReturnQty((p) => ({ ...p, [r.itemId]: e.target.value }))}
                  />
                ) : (
                  <span className="block text-right text-[11px] text-ik-ink-3">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {anyOutstanding && (
        <div className="mt-3">
          <Button size="sm" variant="outline" disabled={returning} onClick={recordReturns}>
            {returning ? "Recording…" : "Record returned items"}
          </Button>
        </div>
      )}
    </section>
  );
}
