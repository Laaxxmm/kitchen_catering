import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listCustomers } from "@/server/actions/customers";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string }>;
}) {
  const sp = await searchParams;
  const includeInactive = sp.inactive === "1";
  const customers = await listCustomers({
    query: sp.q,
    active: includeInactive ? undefined : true,
  });

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Customers"
        description="Companies you cater for. Each customer carries a GSTIN, place-of-supply state code, and credit terms."
        actions={
          <Link href="/customers/new">
            <Button>New customer</Button>
          </Link>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/customers">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search by name, GSTIN, contact…"
          className="h-9 w-72 rounded-md border border-ik-rule bg-ik-card px-3 text-[13px]"
        />
        <label className="flex items-center gap-1 text-[12px] text-ik-ink-2">
          <input type="checkbox" name="inactive" value="1" defaultChecked={includeInactive} />
          Include inactive
        </label>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
      </form>

      {customers.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No customers match the current filter.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>GSTIN</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link href={`/customers/${c.id}`} className="text-brand hover:underline">
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-[12px]">{c.gstin ?? "—"}</TableCell>
                <TableCell>{c.group?.name ?? "—"}</TableCell>
                <TableCell>{c.stateCode}</TableCell>
                <TableCell>
                  {c.contactName ?? "—"}
                  {c.phone ? <span className="text-ik-ink-3"> · {c.phone}</span> : null}
                </TableCell>
                <TableCell>
                  {c.active ? (
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
