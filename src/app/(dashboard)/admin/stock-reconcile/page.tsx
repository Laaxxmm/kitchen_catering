import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SummaryStrip } from "@/components/ik/StatChips";
import { gateRolePage } from "@/server/rbac";
import { previewGrnStockReconcile, type UnpostedLine } from "@/server/actions/reconcile-grn-stock";
import { ReconcileButton } from "./ReconcileButton";

export const dynamic = "force-dynamic";

const REASON_LABEL: Record<string, string> = {
  "unit-match": "Units agree — will post",
  "unit-mismatch-fresh": "Bought in a different unit; item untouched — unit will be re-based + posted",
  "unit-mismatch-has-stock": "Unit differs and the item already holds stock — needs a manual conversion",
  "free-text": "PO line isn't linked to a stock item — link it or use Stock adjustment",
};

export default async function StockReconcilePage() {
  await gateRolePage([Role.ADMIN]);
  const res = await previewGrnStockReconcile();

  if (!res.ok) {
    return (
      <>
        <PageHeader eyebrow="Admin" title="Reconcile received stock" />
        <p className="text-[13px] text-alert">{res.error}</p>
      </>
    );
  }

  const { lines, postable, manual } = res;
  const postableRows = lines.filter((l) => l.postable);
  const manualRows = lines.filter((l) => !l.postable);

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Reconcile received stock"
        description="Goods that were received (GRN accepted) but never added to stock — usually because the PO was bought in a different unit than the catalogue tracks. Review, then post the safe ones in one click."
      />

      <div className="mb-5">
        <SummaryStrip
          chips={[
            { label: "Unposted lines", value: lines.length },
            { label: "Will post", value: postable, tone: postable > 0 ? "green" : "grey" },
            { label: "Need a human", value: manual, tone: manual > 0 ? "amber" : "grey" },
          ]}
        />
      </div>

      {lines.length === 0 ? (
        <p className="rounded-2xl border border-ik-rule bg-ik-card p-6 text-center text-[13px] text-ik-ink-2 shadow-ik-card">
          Nothing to reconcile — every received line is already in stock. ✅
        </p>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <ReconcileButton disabled={postable === 0} />
            {postable > 0 && (
              <span className="text-[12.5px] text-ik-ink-3">
                Posts {postable} line{postable === 1 ? "" : "s"} to stock. Idempotent + audited — safe to run.
              </span>
            )}
          </div>

          <Section title={`Will post (${postableRows.length})`} rows={postableRows} />
          {manualRows.length > 0 && <Section title={`Need a human (${manualRows.length})`} rows={manualRows} />}
        </>
      )}
    </>
  );
}

function Section({ title, rows }: { title: string; rows: UnpostedLine[] }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">{title}</h2>
      <div className="overflow-x-auto rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>GRN · PO</TableHead>
              <TableHead className="text-right">Accepted</TableHead>
              <TableHead>Bought / catalogued</TableHead>
              <TableHead>What happens</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.grnLineId}>
                <TableCell>
                  <div className="font-medium text-ik-ink">{r.itemName}</div>
                  {r.sku && <div className="font-mono text-[11px] text-ik-ink-3">{r.sku}</div>}
                </TableCell>
                <TableCell className="font-mono text-[11.5px] text-ik-ink-2">{r.grnNo} · {r.poNo}</TableCell>
                <TableCell className="text-right tabular-nums">{r.acceptedQty} {r.poUnit}</TableCell>
                <TableCell className="text-[12.5px] text-ik-ink-2">
                  {r.poUnit} / {r.catalogueUnit ?? "—"}
                </TableCell>
                <TableCell className="text-[12px] text-ik-ink-2">{REASON_LABEL[r.reason] ?? r.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
