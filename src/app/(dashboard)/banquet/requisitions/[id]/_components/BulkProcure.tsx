"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResultWith } from "@/lib/action-result";
import type { VendorOption } from "./LineFulfilControls";

/**
 * Tick several short lines, pick ONE vendor, get ONE draft PO. The page is a
 * server component, so the selection lives here: the provider wraps the table
 * and each row's LineFulfilControls reads it through the context to render its
 * checkbox. No context (viewer can't fulfil) → no checkboxes.
 */
export type BulkLine = { lineId: string; itemName: string; unit: string; shortfall: string };

type BulkCtx = {
  selected: BulkLine[];
  toggle: (line: BulkLine) => void;
};

const Ctx = createContext<BulkCtx | null>(null);

export function useBulkProcure() {
  return useContext(Ctx);
}

export function BulkProcureProvider({
  vendors,
  onRaiseBulkPO,
  children,
}: {
  vendors: VendorOption[];
  onRaiseBulkPO: (
    lines: { requisitionLineId: string; unitPrice: string }[],
    vendorId: string,
  ) => Promise<ActionResultWith<{ poId: string; poNo: string }>>;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<BulkLine[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [vendorId, setVendorId] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle(line: BulkLine) {
    setSelected((cur) =>
      cur.some((l) => l.lineId === line.lineId)
        ? cur.filter((l) => l.lineId !== line.lineId)
        : [...cur, line],
    );
  }

  function raise() {
    if (!vendorId) {
      toast.error("Pick the vendor to raise the PO on");
      return;
    }
    startTransition(async () => {
      try {
        const res = await onRaiseBulkPO(
          selected.map((l) => ({
            requisitionLineId: l.lineId,
            unitPrice: (prices[l.lineId] ?? "").trim() || "0",
          })),
          vendorId,
        );
        if (res.ok === false) {
          toast.error(res.error);
          return;
        }
        toast.success(
          `PO ${res.poNo} raised for ${selected.length} item${selected.length === 1 ? "" : "s"}`,
        );
        setSelected([]);
        setPrices({});
        setVendorId("");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Action failed");
      }
    });
  }

  return (
    <Ctx.Provider value={{ selected, toggle }}>
      {children}
      {selected.length > 0 && (
        <div className="sticky bottom-0 z-10 mt-4 rounded-md border border-ik-rule bg-ik-card p-3 text-[12.5px] shadow-lg">
          <div className="mb-2 font-medium">
            {selected.length} item{selected.length === 1 ? "" : "s"} on one purchase order
          </div>
          <div className="mb-2 flex flex-col gap-1">
            {selected.map((l) => (
              <div key={l.lineId} className="flex items-center gap-2">
                <span className="min-w-40 flex-1">{l.itemName}</span>
                <span className="font-mono text-ik-ink-3">
                  {l.shortfall} {l.unit}
                </span>
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="₹/unit (est.)"
                  value={prices[l.lineId] ?? ""}
                  onChange={(e) =>
                    setPrices((cur) => ({ ...cur, [l.lineId]: e.target.value }))
                  }
                  className="h-7 w-28 rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => toggle(l)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className={
                "h-7 max-w-48 rounded border bg-ik-card px-1 " +
                (vendorId ? "border-ik-rule" : "border-amber")
              }
            >
              <option value="">Pick vendor…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code} · {v.name}
                </option>
              ))}
            </select>
            <Button type="button" size="sm" disabled={pending} onClick={raise}>
              Raise 1 PO for {selected.length} item{selected.length === 1 ? "" : "s"}
            </Button>
            <span className="text-[10.5px] text-ik-ink-3">
              Prices are estimates — management corrects them at approval.
            </span>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
