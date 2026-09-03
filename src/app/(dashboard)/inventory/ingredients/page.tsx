import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import { listIngredients, listStockHealth, type StockHealthRow } from "@/server/actions/inventory";
import { toDecimal } from "@/lib/money";
import {
  RUNNING_OUT_DAYS,
  TARGET_COVER_DAYS,
  WATCH_DAYS,
  type StockBucket,
} from "@/lib/stock-health";
import { SummaryStrip } from "@/components/ik/StatChips";
import { StatusPill } from "@/components/ik/StatusPill";
import { InventoryNav } from "../_components/InventoryNav";
import { ReorderCell } from "./_components/ReorderCell";

export const dynamic = "force-dynamic";

/**
 * What to buy, and nothing else at the top of the page.
 *
 * This screen used to lead with "Out of stock", counted as on-hand ≤ 0 and
 * nothing more. After the catalogue import that meant ~285 of 405 items —
 * every row created with no opening count that nobody has ever drawn. The
 * store read it once, concluded it meant nothing, and went back to walking
 * the shelves every morning and ordering off a physical look.
 *
 * So the cards are now cut by usage: what has run out AND is actually used,
 * what runs out within a week at the current rate, what to keep an eye on.
 * Items nobody has ever touched are counted quietly at the bottom instead of
 * dominating the page, which is the whole "keep it low key until it's used".
 */
export default async function IngredientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; hidden?: string }>;
}) {
  const sp = await searchParams;
  const showingHidden = sp.hidden === "1";
  const [session, health, hiddenItems] = await Promise.all([
    auth(),
    showingHidden ? Promise.resolve([]) : listStockHealth(),
    showingHidden ? listIngredients({ active: false }) : Promise.resolve([]),
  ]);
  const role = session?.user?.role as Role | undefined;
  const canEdit = role === Role.ADMIN || role === Role.MANAGER || role === Role.STORE_KEEPER;
  // Creating a NEW ingredient is management-only — the store and the chef were
  // adding duplicates of the same item under different names/units, which
  // stranded GRNs and corrupted stock. They can still edit what exists.
  const canAdd = role === Role.ADMIN || role === Role.MANAGER;

  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = q
    ? health.filter((r) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q))
    : health;

  const of = (bucket: StockBucket) => rows.filter((r) => r.bucket === bucket);
  const outNeeded = of("OUT_NEEDED");
  const runningOut = of("RUNNING_OUT");
  const watch = of("WATCH");
  const healthy = of("HEALTHY");
  const neverUsed = of("NEVER_USED");
  const dormant = of("DORMANT");

  // The order list: everything the store would otherwise walk the shelves to
  // find. Emptiest first, so the top of the list is the most urgent.
  const toOrder = [...outNeeded, ...runningOut].sort(
    (a, b) => (a.daysCover ?? 0) - (b.daysCover ?? 0),
  );

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Kitchen stock"
        description={`What to order, worked out from how fast each item is actually being used — not from a reorder level somebody has to set by hand. Under ${RUNNING_OUT_DAYS} days of cover is an order; ${RUNNING_OUT_DAYS}–${WATCH_DAYS} days is a watch.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={showingHidden ? "/inventory/ingredients" : "/inventory/ingredients?hidden=1"}>
              <Button variant="ghost">{showingHidden ? "← Back to active items" : "Show hidden items"}</Button>
            </Link>
            {(role === Role.ADMIN || role === Role.MANAGER || role === Role.ACCOUNTS) && (
              <a href="/api/export/stock"><Button variant="outline">Download Excel</Button></a>
            )}
            {role === Role.ADMIN && (
              <Link href="/admin/stock-reconcile">
                <Button variant="outline">Reconcile received stock</Button>
              </Link>
            )}
            {canAdd && (
              <Link href="/inventory/ingredients/new">
                <Button variant="outline">New ingredient</Button>
              </Link>
            )}
          </div>
        }
      />
      <InventoryNav active="ingredients" role={role} />

      {showingHidden ? (
        <>
          <p className="mb-3 rounded-md border border-amber bg-amber-wash px-3 py-2 text-[12.5px] text-amber-700">
            Showing hidden (deactivated) ingredients — open one to unhide it.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">On hand</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hiddenItems.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="whitespace-nowrap font-mono text-[12px] text-ik-ink-2">{i.sku}</TableCell>
                  <TableCell>
                    <Link href={`/inventory/ingredients/${i.id}`} className="text-brand hover:underline">{i.name}</Link>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {toDecimal(i.onHandQty).toString()} <span className="text-ik-ink-3">{i.unit}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      ) : (
        <>
          <div className="mb-4">
            <SummaryStrip
              chips={[
                { label: "Out — needed", value: outNeeded.length, tone: outNeeded.length > 0 ? "red" : "grey" },
                { label: "Running out", value: runningOut.length, tone: runningOut.length > 0 ? "amber" : "grey" },
                { label: "Watch", value: watch.length, tone: watch.length > 0 ? "ink" : "grey" },
                { label: "Healthy", value: healthy.length, tone: "green" },
              ]}
            />
          </div>

          <form className="mb-4 flex flex-wrap items-end gap-2" action="/inventory/ingredients">
            <input
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder="Search by name or code…"
              className="h-9 w-64 rounded-md border border-ik-rule bg-ik-card px-3 text-[13px]"
            />
            <Button type="submit" variant="outline" size="sm">Search</Button>
          </form>

          {/* The list that replaces the morning walk. */}
          <section className="mb-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">
                To order{toOrder.length > 0 ? ` (${toOrder.length})` : ""}
              </h2>
              {toOrder.length > 0 && (
                <Link href="/procurement/purchase-orders/new">
                  <Button size="sm">Raise a purchase order</Button>
                </Link>
              )}
            </div>
            {toOrder.length === 0 ? (
              <p className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 text-[13px] text-ik-ink-2">
                Nothing to order — every item being used has more than {RUNNING_OUT_DAYS} days of cover.
              </p>
            ) : (
              <StockTable rows={toOrder} canEdit={canEdit} showSuggested />
            )}
          </section>

          {watch.length > 0 && (
            <details className="mb-3 rounded-md border border-ik-rule bg-ik-card">
              <summary className="cursor-pointer px-3 py-2.5 text-[12.5px] text-ik-ink-2">
                Watch ({watch.length}) · {RUNNING_OUT_DAYS}–{WATCH_DAYS} days of cover left
              </summary>
              <div className="border-t border-ik-rule">
                <StockTable rows={watch} canEdit={canEdit} showSuggested />
              </div>
            </details>
          )}

          {healthy.length > 0 && (
            <details className="mb-3 rounded-md border border-ik-rule bg-ik-card">
              <summary className="cursor-pointer px-3 py-2.5 text-[12.5px] text-ik-ink-2">
                Healthy ({healthy.length})
              </summary>
              <div className="border-t border-ik-rule">
                <StockTable rows={healthy} canEdit={canEdit} showSuggested={false} />
              </div>
            </details>
          )}

          {/* Kept quiet on purpose: neither is a shortage, and together they
              are most of the catalogue. */}
          {dormant.length > 0 && (
            <details className="mb-3 rounded-md border border-ik-rule bg-ik-card">
              <summary className="cursor-pointer px-3 py-2.5 text-[12.5px] text-ik-ink-2">
                Not moving ({dormant.length}) · stock on the shelf nothing has drawn in two months
              </summary>
              <div className="border-t border-ik-rule">
                <StockTable rows={dormant} canEdit={canEdit} showSuggested={false} />
              </div>
            </details>
          )}

          {neverUsed.length > 0 && (
            <details className="mb-3 rounded-md border border-ik-rule bg-ik-card">
              <summary className="cursor-pointer px-3 py-2.5 text-[12.5px] text-ik-ink-2">
                Never used ({neverUsed.length}) · in the catalogue, never issued — not a shortage
              </summary>
              <div className="border-t border-ik-rule">
                <StockTable rows={neverUsed} canEdit={canEdit} showSuggested={false} />
              </div>
            </details>
          )}
        </>
      )}
    </>
  );
}

const BUCKET_PILL: Record<StockBucket, { tone: "red" | "amber" | "green" | "grey"; label: string }> = {
  OUT_NEEDED: { tone: "red", label: "Out" },
  RUNNING_OUT: { tone: "amber", label: "Running out" },
  WATCH: { tone: "amber", label: "Watch" },
  HEALTHY: { tone: "green", label: "Healthy" },
  NEVER_USED: { tone: "grey", label: "Never used" },
  DORMANT: { tone: "grey", label: "Not moving" },
};

function StockTable({
  rows,
  canEdit,
  showSuggested,
}: {
  rows: StockHealthRow[];
  canEdit: boolean;
  showSuggested: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">On hand</TableHead>
          <TableHead className="text-right">Used / day</TableHead>
          <TableHead className="text-right">Days left</TableHead>
          {showSuggested && <TableHead className="text-right">Order</TableHead>}
          <TableHead>Status</TableHead>
          <TableHead className="text-right text-ik-ink-3">Reorder at</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const pill = BUCKET_PILL[r.bucket];
          return (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap font-mono text-[12px] text-ik-ink-2">{r.sku}</TableCell>
              <TableCell>
                <Link href={`/inventory/ingredients/${r.id}`} className="text-brand hover:underline">{r.name}</Link>
              </TableCell>
              <TableCell className="text-right font-mono">
                {r.onHand} <span className="text-ik-ink-3">{r.unit}</span>
              </TableCell>
              <TableCell className="text-right font-mono text-[12px] text-ik-ink-2">
                {Number(r.dailyRate) > 0 ? r.dailyRate : "—"}
              </TableCell>
              <TableCell className="text-right font-mono">
                {r.daysCover === null ? (
                  <span className="text-ik-ink-3">—</span>
                ) : (
                  <span className={r.daysCover < RUNNING_OUT_DAYS ? "font-semibold text-alert" : ""}>
                    {Math.floor(r.daysCover)}
                  </span>
                )}
              </TableCell>
              {showSuggested && (
                <TableCell className="text-right font-mono">
                  {Number(r.suggestedQty) > 0 ? (
                    <span title={`Enough for ${TARGET_COVER_DAYS} days at the current rate`}>
                      {r.suggestedQty} <span className="text-ik-ink-3">{r.unit}</span>
                    </span>
                  ) : (
                    <span className="text-ik-ink-3">—</span>
                  )}
                </TableCell>
              )}
              <TableCell><StatusPill tone={pill.tone}>{pill.label}</StatusPill></TableCell>
              <TableCell className="text-right">
                <ReorderCell id={r.id} value={r.reorderLevel} canEdit={canEdit} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
