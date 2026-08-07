"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clearOrdersKeepFinance,
  resetEverythingKeepParties,
  resetTransactionalData,
} from "@/server/actions/admin-reset";
import { importCatalogueFromFiles } from "@/server/actions/catalogue-import";
import { isNextNavigationError } from "@/lib/next-error";

/**
 * Danger-zone resets. Two levels:
 *   1. Clear orders (keep finance) — wipes the operational order pipeline but
 *      preserves every invoice, payment, bill, petty-cash + salary record and
 *      the audit log. The everyday "start the season fresh" button.
 *   2. Clean slate — wipes ALL transactional data including finance, but
 *      KEEPS both item catalogues.
 *   3. Erase everything — the above PLUS both catalogues, so a replacement
 *      list can be imported into an empty system. The only one that clears
 *      items; the other two deliberately leave them alone.
 * All ADMIN-only (the actions re-check) and gated behind a typed phrase.
 */
export function CleanSlate() {
  return (
    <div className="mt-8 grid gap-4">
      <ImportCatalogue />
      <ClearOrders />
      <FullReset />
      <EraseEverything />
    </div>
  );
}

/**
 * Go-live step two: load the replacement catalogues from the files shipped
 * with the build. Sits above the reset boxes because that is the order it
 * has to run in — importing over the old items collides on their codes.
 */
function ImportCatalogue() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      try {
        const res = await importCatalogueFromFiles();
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(
          `Kitchen ${res.kitchenCreated} added / ${res.kitchenUpdated} updated · ` +
            `F&B ${res.fnbCreated} added / ${res.fnbUpdated} updated · ` +
            `${res.fnbOpeningLines} opening balances received in.`,
        );
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Import failed");
      }
    });
  }

  return (
    <section className="rounded-[14px] border border-ik-rule bg-ik-card p-4 sm:p-5">
      <h3 className="font-serif text-[15px] font-medium text-ik-ink">Import item catalogue</h3>
      <p className="mt-1 max-w-2xl text-[12.5px] text-ik-ink-2">
        Loads the client&apos;s catalogues from the spreadsheets shipped with this build:{" "}
        <strong>405 kitchen items</strong> (GP-001…), <strong>154 in-house F&amp;B</strong>{" "}
        (GP-IN-001…) and <strong>42 hired F&amp;B</strong> (GP-HR-001…), with their opening
        counts. Item codes continue from here for anything added later.
      </p>
      <p className="mt-2 max-w-2xl text-[12.5px] text-ik-ink-2">
        Run this <strong>after</strong> Erase everything. All-or-nothing: if any name clashes with
        an item already in the system, nothing is written and the message names the clash. Safe to
        press twice — a second run refreshes names, units and rates, and leaves stock alone.
      </p>
      <div className="mt-3">
        <Button type="button" disabled={pending} onClick={run}>
          {pending ? "Importing… (up to a minute)" : "Import catalogue"}
        </Button>
      </div>
    </section>
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
        if (!s.ok) {
          toast.error(s.error);
          return;
        }
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
        if (!s.ok) {
          toast.error(s.error);
          return;
        }
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

/**
 * The hard one: wipes both item catalogues as well, so a replacement
 * catalogue can be imported into an empty system. Separate from Clean slate
 * because that one keeps items on purpose — reaching for the wrong button
 * here is expensive, so the copy says plainly what only this one does.
 */
function EraseEverything() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState("");
  const armed = confirm.trim().toUpperCase() === "ERASE EVERYTHING";

  function run() {
    if (!armed) {
      toast.error("Type ERASE EVERYTHING to confirm");
      return;
    }
    startTransition(async () => {
      try {
        const res = await resetEverythingKeepParties("ERASE EVERYTHING");
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(
          `Erased — ${res.kitchenItems} kitchen and ${res.fnbItems} F&B items, ` +
            `${res.orders} orders, ${res.customerInvoices} invoices. Import the new catalogue now.`,
        );
        setConfirm("");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Erase failed");
      }
    });
  }

  return (
    <section className="rounded-2xl border border-alert bg-alert-wash p-4">
      <h3 className="text-[14px] font-semibold text-alert">Danger zone · Erase everything</h3>
      <p className="mt-1 text-[12.5px] text-ik-ink-2">
        Everything Clean slate wipes, <strong>plus both item catalogues</strong> — every kitchen
        ingredient and every F&amp;B item. Use this only when a replacement catalogue is ready to
        import straight afterwards, or the team is left with nothing to pick from.
      </p>
      <p className="mt-2 text-[12.5px] text-ik-ink-2">
        <strong>Kept:</strong> users &amp; logins, customers, vendors, the dish menu and recipes,
        order templates, housekeeping / maintenance masters, settings.
      </p>
      <p className="mt-2 text-[12.5px] text-ik-ink-2">
        Recipe ingredient lines cannot survive — they point at the kitchen catalogue being
        replaced. Dishes and recipes remain, but their ingredient lists come back empty and dish
        costing reads zero until they are rebuilt.
      </p>
      <p className="mt-2 text-[12.5px] font-medium text-alert">
        There is no backup and no undo. Once this runs, the history is gone.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <label htmlFor="erase-confirm" className="text-[11.5px] text-ik-ink-2">
            Type <span className="font-mono font-semibold">ERASE EVERYTHING</span> to confirm
          </label>
          <Input
            id="erase-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="ERASE EVERYTHING"
            className="w-56"
            autoComplete="off"
          />
        </div>
        <Button type="button" variant="destructive" disabled={!armed || pending} onClick={run}>
          {pending ? "Erasing…" : "Erase everything"}
        </Button>
      </div>
    </section>
  );
}
