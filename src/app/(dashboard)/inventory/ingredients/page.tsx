import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import { listIngredients } from "@/server/actions/inventory";
import { toDecimal } from "@/lib/money";
import { SummaryStrip } from "@/components/ik/StatChips";
import { StatusPill } from "@/components/ik/StatusPill";
import { InventoryNav } from "../_components/InventoryNav";
import { ReorderCell } from "./_components/ReorderCell";

export const dynamic = "force-dynamic";

type Status = "out" | "low" | "in";

export default async function IngredientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; hidden?: string }>;
}) {
  const sp = await searchParams;
  const [session, ingredients] = await Promise.all([
    auth(),
    listIngredients({ query: sp.q, active: sp.hidden === "1" ? false : true }),
  ]);
  const role = session?.user?.role as Role | undefined;
  const canEdit = role === Role.ADMIN || role === Role.MANAGER || role === Role.STORE_KEEPER;
  // Catalogue management (add an ingredient) also includes the chef.
  const canAdd = canEdit || role === Role.KITCHEN_HEAD;

  const rows = ingredients.map((i) => {
    const onHand = toDecimal(i.onHandQty);
    const reorder = toDecimal(i.reorderLevel);
    const status: Status = onHand.lte(0) ? "out" : reorder.gt(0) && onHand.lte(reorder) ? "low" : "in";
    return {
      id: i.id, sku: i.sku, name: i.name, unit: i.unit,
      onHand: onHand.toString(), reorder: reorder.toString(),
      avgCost: toDecimal(i.avgUnitCost).toString(),
      status, noLevel: reorder.lte(0),
    };
  });

  const outCount = rows.filter((r) => r.status === "out").length;
  const lowCount = rows.filter((r) => r.status === "low").length;
  const inCount = rows.filter((r) => r.status === "in").length;
  const noLevelCount = rows.filter((r) => r.noLevel).length;

  // Needs-reordering: Out first, then Low; In-stock collapsed below.
  const needs = rows
    .filter((r) => r.status === "out" || r.status === "low")
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "out" ? -1 : 1));
  const inStock = rows.filter((r) => r.status === "in").sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Ingredients"
        description="What's low and what needs reordering — at a glance. Set each item's reorder level so the alerts mean something."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={sp.hidden === "1" ? "/inventory/ingredients" : "/inventory/ingredients?hidden=1"}>
              <Button variant="ghost">{sp.hidden === "1" ? "← Back to active items" : "Show hidden items"}</Button>
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
      {sp.hidden === "1" && (
        <p className="mb-3 rounded-md border border-amber bg-amber-wash px-3 py-2 text-[12.5px] text-amber-700">
          Showing hidden (deactivated) ingredients — open one to unhide it.
        </p>
      )}

      <div className="mb-4">
        <SummaryStrip
          chips={[
            { label: "Out of stock", value: outCount, tone: outCount > 0 ? "red" : "grey" },
            { label: "Running low", value: lowCount, tone: lowCount > 0 ? "amber" : "grey" },
            { label: "In stock", value: inCount, tone: "green" },
          ]}
        />
      </div>

      {noLevelCount > 0 && (
        <div className="mb-4 rounded-md border border-amber/40 bg-amber-wash p-3 text-[12.5px] text-ik-ink-2">
          <strong>{noLevelCount}</strong> {noLevelCount === 1 ? "item has" : "items have"} no reorder level set —
          set the <em>reorder at</em> value below so low-stock alerts work.
        </div>
      )}

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/inventory/ingredients">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search by name or SKU…"
          className="h-9 w-64 rounded-md border border-ik-rule bg-ik-card px-3 text-[13px]"
        />
        <Button type="submit" variant="outline" size="sm">Search</Button>
      </form>

      {/* Needs reordering — the action-first section. */}
      <section className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Needs reordering</h2>
          {needs.length > 0 && (
            <Link href="/procurement/purchase-orders/new?lowstock=1">
              <Button size="sm">Raise PO for all {needs.length}</Button>
            </Link>
          )}
        </div>
        {needs.length === 0 ? (
          <p className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 text-[13px] text-ik-ink-2">
            Nothing needs reordering right now.
          </p>
        ) : (
          <IngredientTable rows={needs} canEdit={canEdit} showStatus />
        )}
      </section>

      {/* In stock — collapsed reference. */}
      {inStock.length > 0 && (
        <details className="rounded-md border border-ik-rule bg-ik-card">
          <summary className="cursor-pointer px-3 py-2.5 text-[12.5px] text-ik-ink-2">
            In stock ({inStock.length})
          </summary>
          <div className="border-t border-ik-rule">
            <IngredientTable rows={inStock} canEdit={canEdit} showStatus={false} />
          </div>
        </details>
      )}
    </>
  );
}

function IngredientTable({
  rows,
  canEdit,
  showStatus,
}: {
  rows: Array<{ id: string; sku: string; name: string; unit: string; onHand: string; reorder: string; avgCost: string; status: Status }>;
  canEdit: boolean;
  showStatus: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">On hand</TableHead>
          <TableHead className="text-right">Reorder at</TableHead>
          {showStatus && <TableHead>Status</TableHead>}
          <TableHead className="text-right text-ik-ink-3">Avg cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              <Link href={`/inventory/ingredients/${r.id}`} className="text-brand hover:underline">{r.name}</Link>
              <span className="ml-2 font-mono text-[11px] text-ik-ink-3">{r.sku}</span>
            </TableCell>
            <TableCell className="text-right font-mono">{r.onHand} <span className="text-ik-ink-3">{r.unit}</span></TableCell>
            <TableCell className="text-right"><ReorderCell id={r.id} value={r.reorder} canEdit={canEdit} /></TableCell>
            {showStatus && (
              <TableCell>
                {r.status === "out" ? (
                  <StatusPill tone="red">Out</StatusPill>
                ) : r.status === "low" ? (
                  <StatusPill tone="amber">Low</StatusPill>
                ) : (
                  <StatusPill tone="green">In stock</StatusPill>
                )}
              </TableCell>
            )}
            <TableCell className="text-right font-mono text-[12px] text-ik-ink-3">{r.avgCost}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
