import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listUsers } from "@/server/actions/users";
import { roleLabel } from "@/lib/role-labels";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const users = await listUsers();
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Users & roles"
        description="All app users with their role. ADMIN role is required to view this page."
        actions={<Link href="/admin/users/new"><Button>New user</Button></Link>}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                <Link href={`/admin/users/${u.id}`} className="text-brand hover:underline">{u.name}</Link>
              </TableCell>
              <TableCell className="font-mono text-[12px]">{u.email}</TableCell>
              <TableCell>{roleLabel(u.role)}</TableCell>
              <TableCell>{u.phone ?? "—"}</TableCell>
              <TableCell>
                {u.active ? <span className="text-positive">Active</span> : <span className="text-ik-ink-3">Inactive</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
