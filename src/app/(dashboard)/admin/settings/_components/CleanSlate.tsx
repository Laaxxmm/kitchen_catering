"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clearOrdersKeepFinance, resetTransactionalData } from "@/server/actions/admin-reset";
import { isNextNavigationError } from "@/lib/next-error";

/**
 * Danger-zone resets. Two levels:
 *   1. Clear orders (keep finance) — wipes the operational order pipeline but
 *      preserves every invoice, payment, bill, petty-cash + salary record and
 *      the audit log. The everyday "start the season fresh" button.
 *   2. Clean slate — wipes ALL transactional data including finance.
 * Both are ADMIN-only (the actions re-check) and gated behind a typed phrase.
 */
export function CleanSlate() {
  return (
    <div className="mt-8 grid gap-4">
      <ClearOrders />
      <FullReset />
    </div>
  );
}

function ClearOrders() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState("");
  const armed = confirm.trim().toUpperCase() === "CLEAR ORDERS";

  function run() {
    if (!armed) {
      toast.error("Type CLEAR ORDERS to confirm");
      return;
    }
    startTransition(async () => {
      try {
        const s = await clearOrdersKeepFinance("CLEAR ORDERS");
        toast.success(
          `Cleared ${s.orders} orders & ${s.deliveries} deliveries. Kept ${s.invoicesKept} invoices & ${s.vendorBillsKept} supplier bills.`,
        );
        setConfirm("");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Clear failed");
      }
    });
  }

  return (
    <section className="rounded-[14px] border border-amber/40 bg-amber-wash p-4 sm:p-5">
      <h3 className="font-serif text-[15px] font-medium text-amber">Clear orders · keep finance</h3>
      <p className="mt-1 max-w-2xl text-[12.5px] text-ik-ink-2">
        Clears the <strong>operational order pipeline</strong> — every order, quote, chef
        requisition, production job, delivery, order stock issue, labour entry, task and
        notification. Order / delivery document numbers restart at <strong>0001</strong>.
      </p>
      <p className="mt-2 max-w-2xl text-[12.5px] text-ik-ink-2">
        <strong>Kept:</strong> all finance &amp; accounts — customer invoices &amp; payments,
        supplier bills &amp; payments, purchase orders, GRNs, petty cash, salary runs and the
        audit log. Invoice / PO / bill numbering continues unbroken. Stock on-hand is left
        exactly as it is; master data is untouched.
      </p>
      <p className="mt-2 text-[12px] font-medium text-amber">
        Use this to start a fresh season without losing your books. This cannot be undone.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <label htmlFor="confirm-clear" className="text-[11.5px] text-ik-ink-2">
            Type <span className="font-mono font-semibold">CLEAR ORDERS</span> to confirm
          </label>
          <Input
            id="confirm-clear"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="CLEAR ORDERS"
            className="w-48"
            autoComplete="off"
          />
        </div>
        <Button type="button" disabled={!armed || pending} onClick={run}>
          {pending ? "Clearing…" : "Clear orders only"}
        </Button>
      </div>
    </section>
  );
}

function FullReset() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState("");
  const armed = confirm.trim().toUpperCase() === "RESET";

  function run() {
    if (!armed) {
      toast.error("Type RESET to confirm");
      return;
    }
    startTransition(async () => {
      try {
        const s = await resetTransactionalData("RESET");
        toast.success(
          `Clean slate done — cleared ${s.orders} orders & ${s.notifications} notifications. Document numbers restart at 0001.`,
        );
        setConfirm("");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Reset failed");
      }
    });
  }

  return (
    <section className="rounded-[14px] border border-alert-wash bg-alert-wash p-4 sm:p-5">
      <h3 className="font-serif text-[15px] font-medium text-alert">Danger zone · Clean slate</h3>
      <p className="mt-1 max-w-2xl text-[12.5px] text-ik-ink-2">
        Wipes <strong>all operational data</strong> so the team can start fresh: every order,
        quote, requisition, production job, delivery, invoice, payment, procurement record,
        stock movement, petty cash, salary run, task, and <strong>notification</strong> — plus
        the audit log. Document numbers (orders, invoices, POs…) restart at <strong>0001</strong>.
      </p>
      <p className="mt-2 max-w-2xl text-[12.5px] text-ik-ink-2">
        <strong>Kept:</strong> users &amp; logins, customers, dishes &amp; recipes, the
        ingredient / vendor catalogues, settings, salary structures, task presets, rooms and
        staff. Ingredient stock resets to its opening balance; housekeeping / maintenance /
        banquet stock resets to zero.
      </p>
      <p className="mt-2 text-[12px] font-medium text-alert">
        This cannot be undone. Only do this before handing the system to the team.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <label htmlFor="confirm" className="text-[11.5px] text-ik-ink-2">
            Type <span className="font-mono font-semibold">RESET</span> to confirm
          </label>
          <Input
            id="confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="RESET"
            className="w-40"
            autoComplete="off"
          />
        </div>
        <Button type="button" variant="destructive" disabled={!armed || pending} onClick={run}>
          {pending ? "Clearing…" : "Clear everything"}
        </Button>
      </div>
    </section>
  );
}
