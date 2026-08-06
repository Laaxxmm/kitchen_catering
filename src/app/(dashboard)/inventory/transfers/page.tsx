import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import { listRecentTransfers } from "@/server/actions/stock-transfer";
import { STORE_LABELS } from "@/lib/stock-movement";
import { unitsEquivalent } from "@/lib/units";
import { formatIST } from "@/lib/time";
import { InventoryNav } from "../_components/InventoryNav";

export const dynamic = "force-dynamic";

export default async function TransfersPage() {
  const [session, transfers] = await Promise.all([auth(), listRecentTransfers({ limit: 100 })]);
  const role = session?.user?.role as Role | undefined;

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Store transfers"
        description="Stock moving between the kitchen, F&B and housekeeping stores. Each row is one document: the source went down and the destination went up by the same quantity."
        actions={
          <Link href="/inventory/transfers/new">
            <Button>Record transfer</Button>
          </Link>
        }
      />
      <InventoryNav active="transfers" role={role} />

      {transfers.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No transfers yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Out of</TableHead>
              <TableHead>Into</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Cost/unit</TableHead>
              <TableHead>By</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transfers.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-[12px]">{formatIST(t.transferredAt)}</TableCell>
                <TableCell>
                  {t.fromItemName}{" "}
                  <span className="text-ik-ink-3">
                    · {STORE_LABELS[t.fromStore]} · {t.fromUnit}
                  </span>
                </TableCell>
                <TableCell>
                  {t.toItemName}{" "}
                  <span className="text-ik-ink-3">
                    · {STORE_LABELS[t.toStore]} · {t.toUnit}
                  </span>
                  {/* Kept visible after the fact: a cross-unit move is a
                      deliberate decision, not something to discover later. */}
                  {!unitsEquivalent(t.fromUnit, t.toUnit) && (
                    <span className="ml-1 text-amber-600">· unit change</span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono">{t.quantity.toString()}</TableCell>
                <TableCell className="text-right font-mono">
                  {t.unitCost ? `₹${t.unitCost.toString()}` : "—"}
                </TableCell>
                <TableCell className="text-ik-ink-2">{t.recordedBy.name}</TableCell>
                <TableCell className="text-ik-ink-2">{t.notes ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
