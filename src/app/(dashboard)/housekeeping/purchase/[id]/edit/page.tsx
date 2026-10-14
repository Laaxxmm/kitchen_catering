import { DeptPurchaseEditPage } from "@/components/ik/dept-purchase/pages";

export const dynamic = "force-dynamic";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <DeptPurchaseEditPage department="HOUSEKEEPING" params={params} />;
}
