import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import { listDishes } from "@/server/actions/dishes";
import { toDecimal, formatINRWhole } from "@/lib/money";
import { SummaryStrip } from "@/components/ik/StatChips";
import { StatusPill } from "@/components/ik/StatusPill";

export const dynamic = "force-dynamic";

export default async function DishesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string }>;
}) {
  const sp = await searchParams;
  const [session, dishes] = await Promise.all([
    auth(),
    listDishes({ query: sp.q, active: sp.inactive === "1" ? undefined : true }),
  ]);
  const role = session?.user?.role as Role | undefined;
  const isChef = role === Role.KITCHEN_HEAD;
  const canCreate = role === Role.ADMIN || role === Role.MANAGER || role === Role.SALES;
  const includeInactive = sp.inactive === "1";

  const categories = new Set(dishes.map((d) => d.category).filter(Boolean)).size;
  const zeroPriced = dishes.filter((d) => toDecimal(d.unitPrice).lte(0)).length;

  return (
    <>
      <PageHeader
        eyebrow={isChef ? "Kitchen" : "Sell"}
        title="Menu"
        description={isChef ? "Menu reference — what we cook." : "Every dish with its price and GST. Search to find one fast."}
        actions={canCreate ? <Link href="/dishes/new"><Button>New dish</Button></Link> : null}
      />

      {!isChef && (
        <div className="mb-4">
          <SummaryStrip
            chips={[
              { label: "Dishes", value: dishes.length, tone: "ink" },
              { label: "Categories", value: categories, tone: "ink" },
              { label: "Priced ₹0 — set price", value: zeroPriced, tone: zeroPriced > 0 ? "amber" : "grey" },
            ]}
          />
        </div>
      )}

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/dishes">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search by name, code, category…"
          className="h-9 w-80 rounded-md border border-ik-rule bg-ik-card px-3 text-[13px]"
        />
        <label className="flex items-center gap-1 text-[12px] text-ik-ink-2">
          <input type="checkbox" name="inactive" value="1" defaultChecked={includeInactive} />
          Include inactive
        </label>
        <Button type="submit" variant="outline" size="sm">Search</Button>
      </form>

      {dishes.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No dishes match the current filter.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dish</TableHead>
              <TableHead>Category</TableHead>
              {!isChef && <TableHead className="text-right">Price</TableHead>}
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dishes.map((d) => {
              const zero = toDecimal(d.unitPrice).lte(0);
              return (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link href={`/dishes/${d.id}`} className="text-ik-ink hover:text-brand hover:underline">{d.name}</Link>
                    {d.code && <span className="ml-2 font-mono text-[11px] text-ik-ink-3">{d.code}</span>}
                  </TableCell>
                  <TableCell>
                    {d.category ? (
                      <span className="rounded-full bg-ik-paper-alt px-2 py-0.5 text-[11px] text-ik-ink-2 ring-1 ring-ik-rule">{d.category}</span>
                    ) : "—"}
                  </TableCell>
                  {!isChef && (
                    <TableCell className="text-right">
                      {zero ? <StatusPill tone="amber">set price</StatusPill> : <span className="font-mono">{formatINRWhole(d.unitPrice)}</span>}
                    </TableCell>
                  )}
                  <TableCell>
                    {d.active ? <StatusPill tone="green">Active</StatusPill> : <StatusPill tone="grey">Inactive</StatusPill>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );
}
