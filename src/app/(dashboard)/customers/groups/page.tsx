import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createCustomerGroup, listCustomerGroups } from "@/server/actions/customer-groups";
import { GroupForm } from "./_components/GroupForm";

export const dynamic = "force-dynamic";

export default async function CustomerGroupsPage() {
  const groups = await listCustomerGroups({ active: true });

  async function create(input: { name: string; description: string | null }) {
    "use server";
    return await createCustomerGroup(input);
  }

  return (
    <>
      <PageHeader
        eyebrow="Sales · Customers"
        title="Customer groups"
        description="Optional groupings (e.g. one parent company with many sites)."
      />

      <GroupForm onCreate={create} />

      {groups.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No groups yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Customers</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <TableRow key={g.id}>
                <TableCell>{g.name}</TableCell>
                <TableCell className="text-ik-ink-2">{g.description ?? "—"}</TableCell>
                <TableCell>{g._count.customers}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
