import { notFound } from "next/navigation";
import { renderPettyCashVoucherPDF } from "@/server/pdf/petty-cash-voucher";
import { getPettyCashVoucherForPdf } from "@/server/actions/petty-cash";

/**
 * GET /api/petty-cash/vouchers/[id]/pdf — streams the voucher PDF.
 *
 * Auth: getPettyCashVoucherForPdf applies the petty-cash read gate
 * (ANY_WRITE roles), matching who can view the float the voucher lives on.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await getPettyCashVoucherForPdf(id);
  if (!v) notFound();

  const buf = await renderPettyCashVoucherPDF({
    voucherNo: v.voucherNo,
    paidAt: v.paidAt,
    floatName: v.float.name,
    paidTo: v.paidTo,
    category: v.category,
    reason: v.reason,
    amount: v.amount.toString(),
    recordedBy: v.createdBy.name,
    status: v.status,
  });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${v.voucherNo}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
