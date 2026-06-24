"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resetTransactionalData } from "@/server/actions/admin-reset";
import { isNextNavigationError } from "@/lib/next-error";

/**
 * Danger-zone "clean slate" — wipes all transactional data so the team can
 * start fresh. ADMIN-only (the action re-checks), and gated behind typing
 * the confirmation word so it can't be hit by accident.
 */
export function CleanSlate() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState("");
  const armed = confirm.trim().toUpperCase() === "RESET";

  function run() {
    if (!armed) {
      toast.error('Type RESET to confirm');
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
    <section className="mt-8 rounded-[14px] border border-alert-wash bg-alert-wash p-4 sm:p-5">
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
        <Button
          type="button"
          variant="destructive"
          disabled={!armed || pending}
          onClick={run}
        >
          {pending ? "Clearing…" : "Clear everything"}
        </Button>
      </div>
    </section>
  );
}
