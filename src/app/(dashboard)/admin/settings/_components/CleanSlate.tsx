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
import {
  removeSampleCatalogueItems,
  type SampleCleanupSummary,
} from "@/server/actions/catalogue-cleanup";
import { applyStockCount, previewStockCount } from "@/server/actions/stock-count-import";
import type { StockCountPlan } from "@/server/stock-count-core";
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
export function CleanSlate({
  stockCounts = [],
}: {
  /** Physical counts shipped with this build (data/stock-counts). */
  stockCounts?: Array<{ id: string; source: string; rows: number }>;
}) {
  return (
    <div className="mt-8 grid gap-4">
      {stockCounts.map((c) => (
        <ApplyStockCount key={c.id} count={c} />
      ))}
      <RemoveSampleItems />
      <ImportCatalogue />
      <ClearOrders />
      <FullReset />
      <EraseEverything />
    </div>
  );
}

/**
 * A physical count from the store's spreadsheet, reconciled into
 * data/stock-counts/<date>.json and applied here in one press: twins merged,
 * missing items created (never duplicated), units corrected, quantities
 * posted as a count, prices set. Check first, then apply.
 */
function ApplyStockCount({ count }: { count: { id: string; source: string; rows: number } }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [plan, setPlan] = useState<StockCountPlan | null>(null);

  function check() {
    startTransition(async () => {
      try {
        const res = await previewStockCount(count.id);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        setPlan(res.plan);
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not read the count");
      }
    });
  }

  function apply() {
    startTransition(async () => {
      try {
        const res = await applyStockCount(count.id);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(
          `Count ${count.id} applied — ${res.quantitiesChanged} quantities, ${res.costsSet} prices, ` +
            `${res.created} new items, ${res.merged} merged, ${res.unitsChanged} units, ` +
            `${res.converted} moved to a new unit with their history.`,
        );
        setPlan(null);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Apply failed");
      }
    });
  }

  const changed = plan
    ? plan.update.filter((u) => u.qtyFrom !== u.qtyTo || (u.costTo !== null && u.costTo !== u.costFrom) || u.unitTo)
    : [];

  return (
    <section className="rounded-[14px] border border-brand-500/40 bg-ik-card p-4 sm:p-5">
      <h3 className="font-serif text-[15px] font-medium text-ik-ink">Apply stock count · {count.id}</h3>
      <p className="mt-1 max-w-2xl text-[12.5px] text-ik-ink-2">
        {count.rows} rows from <em>{count.source}</em>. Sets on-hand and price for every item on the
        sheet through the same paths the store uses — a count posting per item, a receipt or issue
        for the difference — so the ledger stays whole. Anything the sheet names that the catalogue
        lacks is created; anything that already exists by name is updated, never duplicated.
      </p>

      {plan && plan.alreadyApplied && (
        <p className="mt-2 text-[12.5px] font-medium text-positive">Already applied.</p>
      )}
      {plan && !plan.alreadyApplied && (
        <div className="mt-3 grid gap-2 rounded-md border border-ik-rule bg-ik-paper-alt p-3 text-[12.5px]">
          {plan.problems.length > 0 && (
            <PlanBlock tone="alert" title={`${plan.problems.length} problem(s) — fix the file first`} rows={plan.problems} />
          )}
          {plan.merges.length > 0 && (
            <PlanBlock title={`${plan.merges.length} to merge`} rows={plan.merges.map((m) => `${m.from} ${m.fromName} → ${m.into} ${m.intoName}`)} />
          )}
          {plan.create.length > 0 && (
            <PlanBlock title={`${plan.create.length} new item(s)`} rows={plan.create.map((c) => `${c.name} · ${c.qty} ${c.unit}${c.cost ? ` @ ₹${c.cost}` : ""}`)} />
          )}
          {plan.existing.length > 0 && (
            <PlanBlock title={`${plan.existing.length} already exist by name — updated, not duplicated`} rows={plan.existing.map((e) => `${e.code} ${e.name}`)} />
          )}
          <PlanBlock
            title={`${changed.length} of ${plan.update.length} items change`}
            rows={changed.map(
              (u) =>
                `${u.code} ${u.name}: ${u.qtyFrom} → ${u.qtyTo} ${u.unitTo ?? u.unitFrom}` +
                (u.unitTo ? ` (unit ${u.unitFrom} → ${u.unitTo})` : "") +
                (u.costTo !== null && u.costTo !== u.costFrom ? ` · ₹${u.costFrom} → ₹${u.costTo}` : ""),
            )}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={check}>
          {pending ? "Checking…" : "Check what would change"}
        </Button>
        {plan && !plan.alreadyApplied && plan.problems.length === 0 && (
          <Button type="button" disabled={pending} onClick={apply}>
            {pending ? "Applying… (up to a minute)" : `Apply count ${count.id}`}
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * Repair tool, not a reset: folds the seeded sample items back into the
 * imported catalogue on a system that is already live. Check first, then
 * apply — nobody should have to guess how many rows a button on this page is
 * about to touch, least of all when stock is riding on them.
 */
function RemoveSampleItems() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [plan, setPlan] = useState<SampleCleanupSummary | null>(null);

  function run(preview: boolean) {
    startTransition(async () => {
      try {
        const res = await removeSampleCatalogueItems(preview);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        if (preview) {
          setPlan(res);
          if (planTotal(res) === 0) toast.success("No sample items left — the catalogue is clean.");
          return;
        }
        toast.success(
          `${res.kitchen.merge.length} items merged into their GP twins, ` +
            `${res.kitchen.remove.length + res.fnb.remove.length} removed, ` +
            `${res.kitchen.hide.length + res.fnb.hide.length} hidden.`,
        );
        setPlan(null);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Cleanup failed");
      }
    });
  }

  const total = plan ? planTotal(plan) : 0;

  return (
    <section className="rounded-[14px] border border-amber/40 bg-amber-wash p-4 sm:p-5">
      <h3 className="font-serif text-[15px] font-medium text-amber">Clean up sample items</h3>
      <p className="mt-1 max-w-2xl text-[12.5px] text-ik-ink-2">
        The demo catalogue (the <span className="font-mono">STR-</span> kitchen items and the sample
        F&amp;B packaging list) came back on a deploy and the team received stock against it — which
        is why those rows carry figures and the imported <span className="font-mono">GP-</span> ones
        read zero.
      </p>
      <p className="mt-2 max-w-2xl text-[12.5px] text-ik-ink-2">
        Each sample item is <strong>merged into the GP item of the same name</strong>: the stock
        folds in at weighted average cost, and every receipt, issue, recipe line and purchase order
        behind it re-points to the GP item. Nothing is lost — the figures move to where the team can
        see them. Items with no GP twin are removed if nothing references them, hidden if something
        does. Orders, invoices, customers and vendors are untouched.
      </p>

      {plan && total > 0 && (
        <div className="mt-3 grid gap-2 rounded-md border border-ik-rule bg-ik-card p-3 text-[12.5px]">
          <div className="font-medium text-ik-ink">
            {total} sample item{total === 1 ? "" : "s"} found
          </div>
          {plan.kitchen.merge.length > 0 && (
            <PlanBlock
              title={`${plan.kitchen.merge.length} to merge into their GP twin (stock moves across)`}
              rows={plan.kitchen.merge.map(
                (r) => `${r.sku ?? "—"} ${r.name} · ${r.qty} → ${r.intoSku}`,
              )}
            />
          )}
          {plan.kitchen.blocked.length > 0 && (
            <PlanBlock
              tone="alert"
              title={`${plan.kitchen.blocked.length} cannot be merged — units disagree, fix by hand`}
              rows={plan.kitchen.blocked.map((r) => `${r.sku ?? "—"} ${r.name} — ${r.reason}`)}
            />
          )}
          {plan.kitchen.remove.length + plan.fnb.remove.length > 0 && (
            <PlanBlock
              title={`${plan.kitchen.remove.length + plan.fnb.remove.length} to remove (nothing references them)`}
              rows={[...plan.kitchen.remove, ...plan.fnb.remove].map(
                (r) => `${r.sku ?? "—"} ${r.name}`,
              )}
            />
          )}
          {plan.kitchen.hide.length + plan.fnb.hide.length > 0 && (
            <PlanBlock
              title={`${plan.kitchen.hide.length + plan.fnb.hide.length} to hide (in use, so kept)`}
              rows={[...plan.kitchen.hide, ...plan.fnb.hide].map((r) => `${r.sku ?? "—"} ${r.name}`)}
            />
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={() => run(true)}>
          {pending ? "Checking…" : "Check what would happen"}
        </Button>
        {plan && total > 0 && (
          <Button type="button" disabled={pending} onClick={() => run(false)}>
            {pending ? "Working… (up to a minute)" : `Apply to these ${total}`}
          </Button>
        )}
      </div>
    </section>
  );
}

function planTotal(s: SampleCleanupSummary): number {
  const side = (p: SampleCleanupSummary["kitchen"]) =>
    p.merge.length + p.remove.length + p.hide.length + p.blocked.length;
  return side(s.kitchen) + side(s.fnb);
}

/** A named group of the plan, capped so 136 rows don't bury the buttons. */
function PlanBlock({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: string[];
  tone?: "alert";
}) {
  return (
    <div>
      <div className={"font-medium " + (tone === "alert" ? "text-alert" : "text-ik-ink-2")}>
        {title}
      </div>
      <ul className="mt-0.5 grid gap-0.5 text-[11.5px] text-ik-ink-3">
        {rows.slice(0, 8).map((r) => (
          <li key={r} className="font-mono">{r}</li>
        ))}
        {rows.length > 8 && <li>and {rows.length - 8} more</li>}
      </ul>
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
