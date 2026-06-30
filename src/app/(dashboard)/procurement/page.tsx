import { redirect } from "next/navigation";

// The Procurement card-menu page is retired — its cards now live as the
// "Buy" nav group (Purchase orders / Vendors / Supplier bills). Land directly
// on Purchase orders, the first Buy sub-page.
export default function ProcurementPage() {
  redirect("/procurement/purchase-orders");
}
