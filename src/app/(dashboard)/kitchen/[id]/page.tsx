import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  assignChef,
  getProductionJob,
  listChefs,
  markProductionItemReady,
  startProductionItem,
} from "@/server/actions/production-jobs";
import { formatIST } from "@/lib/time";
import { ItemControls } from "./_components/ItemControls";

export const dynamic = "force-dynamic";

export default async function KitchenJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [job, chefs] = await Promise.all([getProductionJob(id), listChefs()]);
  if (!job) notFound();

  async function doAssign(itemId: string, chefUserId: string) {
    "use server";
    await assignChef({ itemId, chefUserId });
  }
  async function doStart(itemId: string) {
    "use server";
    await startProductionItem(itemId);
  }
  async function doReady(itemId: string) {
    "use server";
    await markProductionItemReady(itemId);
  }

  return (
    <>
      <PageHeader
        eyebrow={`Job · Order ${job.order.code}`}
        title={job.jobNo}
        description={`${job.order.customer.name} · event ${formatIST(job.order.eventDate, "EEE d MMM HH:mm")}`}
        actions={
          <div className="flex gap-2">
            <Link href="/kitchen"><Button variant="outline">Back to board</Button></Link>
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-3 text-[13px]">
        <StatusBadge status={job.status} />
        <span className="text-ik-ink-3">
          Scheduled start {formatIST(job.scheduledStart, "HH:mm")} · ready by {formatIST(job.scheduledReady, "HH:mm")}
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Dish</TableHead>
            <TableHead className="text-right">Portions</TableHead>
            <TableHead>Chef</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {job.items.map((it) => (
            <TableRow key={it.id}>
              <TableCell>{it.dish.name}</TableCell>
              <TableCell className="text-right font-mono">{it.portions.toString()}</TableCell>
              <TableCell>
                <ItemControls
                  itemId={it.id}
                  chefUserId={it.chefUserId}
                  status={it.status}
                  chefs={chefs}
                  onAssign={doAssign}
                  onStart={doStart}
                  onReady={doReady}
                  mode="assign"
                />
              </TableCell>
              <TableCell><StatusBadge status={it.status} /></TableCell>
              <TableCell>
                <ItemControls
                  itemId={it.id}
                  chefUserId={it.chefUserId}
                  status={it.status}
                  chefs={chefs}
                  onAssign={doAssign}
                  onStart={doStart}
                  onReady={doReady}
                  mode="actions"
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
