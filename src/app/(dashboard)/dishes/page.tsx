import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listDishes } from "@/server/actions/dishes";

export const dynamic = "force-dynamic";

export default async function DishesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string }>;
}) {
  const sp = await searchParams;
  const includeInactive = sp.inactive === "1";
  const dishes = await listDishes({
    query: sp.q,
    active: includeInactive ? undefined : true,
  });

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Dishes"
        description="Catalogue of menu items with unit price and GST rate."
        actions={
          <Link href="/dishes/new">
            <Button>New dish</Button>
          </Link>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/dishes">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search by name, code, category…"
          className="h-9 w-72 rounded-md border border-ik-rule bg-ik-card px-3 text-[13px]"
        />
        <label className="flex items-center gap-1 text-[12px] text-ik-ink-2">
          <input type="checkbox" name="inactive" value="1" defaultChecked={includeInactive} />
          Include inactive
        </label>
        <Button type="submit" variant="outline" size="sm">Apply</Button>
      </form>

      {dishes.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No dishes match the current filter.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">GST %</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dishes.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-mono text-[12px]">{d.code ?? "—"}</TableCell>
                <TableCell>
                  <Link href={`/dishes/${d.id}`} className="text-brand hover:underline">
                    {d.name}
                  </Link>
                </TableCell>
                <TableCell>{d.category ?? "—"}</TableCell>
                <TableCell>{d.unit}</TableCell>
                <TableCell className="text-right font-mono">₹{d.unitPrice.toString()}</TableCell>
                <TableCell className="text-right font-mono">{d.gstRatePct.toString()}</TableCell>
                <TableCell>
                  {d.active ? (
                    <span className="text-positive">Active</span>
                  ) : (
                    <span className="text-ik-ink-3">Inactive</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
