import Link from "next/link";
import { Role, type IngredientSubStore } from "@prisma/client";
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
 * So the cards are cut by usage: what has run out AND is actually used,
 * what runs out within a week at the current rate, what to keep an eye on.
 * Items nobody has ever touched are counted quietly instead of dominating
 * the page.
 *
 * Two rows of tabs. The first is the shelf — grocery, vegetable, dairy,
 * frozen — because a nil in the dry store (order it) and a nil in the
 * vegetable rack (it is bought fresh every morning) are different jobs and
 * were landing in one list. The second is the state, with nil stock on its
 * own tab rather than merged into "to order" with the running-out items.
 */

const STORE_LABEL: Record<IngredientSubStore, string> = {
  GROCERY: "Grocery",
  VEGETABLE: "Vegetable & fruit",
  MILK: "Dairy",
  FROZEN: "Frozen & ready-made",
  WATER: "Water",
  OTHER: "Other",
};
const STORE_ORDER: IngredientSubStore[] = ["GROCERY", "VEGETABLE", "MILK", "FROZEN", "WATER", "OTHER"];

type TabKey = "out" | "running" | "watch" | "healthy" | "never" | "dormant";
const TABS: Array<{ key: TabKey; bucket: StockBucket; label: string; tone: "red" | "amber" | "ink" | "green" | "grey"; hint: string }> = [
  { key: "out", bucket: "OUT_NEEDED", label: "Nil stock", tone: "red", hint: "Empty, and the kitchen has been drawing it — order today." },
  { key: "running", bucket: "RUNNING_OUT", label: "Running out", tone: "amber", hint: `Under ${RUNNING_OUT_DAYS} days of cover at the current rate.` },
  { key: "watch", bucket: "WATCH", label: "Watch", tone: "ink", hint: `${RUNNING_OUT_DAYS}–${WATCH_DAYS} days of cover left.` },
  { key: "healthy", bucket: "HEALTHY", label: "Healthy", tone: "green", hint: `More than ${WATCH_DAYS} days of cover.` },
  { key: "never", bucket: "NEVER_USED", label: "Never used", tone: "grey", hint: "In the catalogue, never issued — not a shortage." },
  { key: "dormant", bucket: "DORMANT", label: "Not moving", tone: "grey", hint: "Stock on the shelf that nothing has drawn in two months." },
];

function href(q: string, store: string, tab: string): string {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (store !== "ALL") p.set("store", store);
  if (tab !== "out") p.set("tab", tab);
  const s = p.toString();
  return `/inventory/ingredients${s ? `?${s}` : ""}`;
}

export default async function IngredientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; hidden?: string; store?: string; tab?: string }>;
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
  const searched = q
    ? health.filter((r) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q))
    : health;

  const store: IngredientSubStore | "ALL" = STORE_ORDER.includes(sp.store as IngredientSubStore)
    ? (sp.store as IngredientSubStore)
    : "ALL";
  const rows = store === "ALL" ? searched : searched.filter((r) => r.subStore === store);
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const of = (bucket: StockBucket) => rows.filter((r) => r.bucket === bucket);
  const shown = of(tab.bucket).sort((a, b) => (a.daysCover ?? 0) - (b.daysCover ?? 0));
  const orderable = tab.key === "out" || tab.key === "running";

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
          {/* Shelf tabs — which store the items live in. */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {(["ALL", ...STORE_ORDER] as const).map((s) => {
              const n = s === "ALL" ? searched.length : searched.filter((r) => r.subStore === s).length;
              if (s !== "ALL" && n === 0) return null;
              const active = store === s;
              return (
                <Link
                  key={s}
                  href={href(q, s, tab.key)}
                  className={
                    "rounded-full border px-3 py-1 text-[12.5px] transition " +
                    (active
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-ik-rule bg-ik-card text-ik-ink-2 hover:border-brand-200")
                  }
                >
                  {s === "ALL" ? "All shelves" : STORE_LABEL[s]} <span className="font-mono text-ik-ink-3">{n}</span>
                </Link>
              );
            })}
          </div>

          {/* State tabs — nil stock on its own, not merged into "to order". */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {TABS.map((t) => {
              const n = of(t.bucket).length;
              const active = tab.key === t.key;
              const numTone =
                n === 0
                  ? "text-ik-ink-3"
                  : t.tone === "red"
                    ? "text-alert"
                    : t.tone === "amber"
                      ? "text-amber"
                      : t.tone === "green"
                        ? "text-positive"
                        : "text-ik-ink";
              return (
                <Link
                  key={t.key}
                  href={href(q, store, t.key)}
                  className={
                    "rounded-[12px] border p-3 text-left transition " +
                    (active ? "border-brand-500 bg-brand-50" : "border-ik-rule bg-ik-card hover:border-brand-200")
                  }
                >
                  <div className={"font-mono text-[20px] leading-none " + numTone}>{n}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ik-ink-2">
                    {t.label}
                    {t.key === "out" && n > 0 && (
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-alert" aria-label="urgent" />
                    )}
                  </div>
                </Link>
              );
            })}
          </div>

          <form className="mb-4 flex flex-wrap items-end gap-2" action="/inventory/ingredients">
            {store !== "ALL" && <input type="hidden" name="store" value={store} />}
            {tab.key !== "out" && <input type="hidden" name="tab" value={tab.key} />}
            <input
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder="Search by name or code…"
              className="h-9 w-64 rounded-md border border-ik-rule bg-ik-card px-3 text-[13px]"
            />
            <Button type="submit" variant="outline" size="sm">Search</Button>
          </form>

          <section className="mb-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">
                {tab.label}
                {store !== "ALL" ? ` · ${STORE_LABEL[store]}` : ""}
                {shown.length > 0 ? ` (${shown.length})` : ""}
                <span className="ml-2 normal-case tracking-normal text-ik-ink-3">{tab.hint}</span>
              </h2>
              {orderable && shown.length > 0 && (
                <Link href="/procurement/purchase-orders/new">
                  <Button size="sm">Raise a purchase order</Button>
                </Link>
              )}
            </div>
            {shown.length === 0 ? (
              <p className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 text-[13px] text-ik-ink-2">
                {tab.key === "out"
                  ? "Nothing at nil that the kitchen uses — every item being drawn has stock."
                  : `Nothing under "${tab.label}"${store !== "ALL" ? ` on the ${STORE_LABEL[store].toLowerCase()} shelf` : ""}.`}
              </p>
            ) : (
              <StockTable rows={shown} canEdit={canEdit} showSuggested={orderable} showStore={store === "ALL"} />
            )}
          </section>
        </>
      )}
    </>
  );
}

const BUCKET_PILL: Record<StockBucket, { tone: "red" | "amber" | "green" | "grey"; label: string }> = {
  OUT_NEEDED: { tone: "red", label: "Nil" },
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
  showStore,
}: {
  rows: StockHealthRow[];
  canEdit: boolean;
  showSuggested: boolean;
  showStore: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Name</TableHead>
          {showStore && <TableHead>Shelf</TableHead>}
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
              {showStore && <TableCell className="text-[12px] text-ik-ink-2">{STORE_LABEL[r.subStore]}</TableCell>}
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
