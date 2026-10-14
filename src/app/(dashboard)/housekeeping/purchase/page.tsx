import { DeptPurchaseListPage } from "@/components/ik/dept-purchase/pages";

export const dynamic = "force-dynamic";

export default function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  return <DeptPurchaseListPage department="HOUSEKEEPING" searchParams={searchParams} />;
}
