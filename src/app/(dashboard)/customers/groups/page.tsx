import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createCustomerGroup, listCustomerGroups } from "@/server/actions/customer-groups";

export const dynamic = "force-dynamic";

export default async function CustomerGroupsPage() {
  const groups = await listCustomerGroups({ active: true });

  async function create(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    if (!name) return;
    await createCustomerGroup({ name, description: description || null });
  }

  return (
    <>
      <PageHeader
        eyebrow="Sales · Customers"
        title="Customer groups"
        description="Optional groupings (e.g. one parent company with many sites)."
      />

      <form action={create} className="mb-6 grid max-w-xl gap-3 rounded-md border border-ik-rule bg-ik-card p-4">
        <div className="grid gap-1">
          <Label htmlFor="name">Group name</Label>
          <Input id="name" name="name" required />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="description">Description (optional)</Label>
          <Input id="description" name="description" />
        </div>
        <div>
          <Button type="submit" size="sm">Create group</Button>
        </div>
      </form>

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
