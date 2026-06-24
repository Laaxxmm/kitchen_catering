import { redirect } from "next/navigation";

// The Procurement card-menu page is retired — its five cards now live as the
// "Buy" nav group (Requests / Purchase orders / Vendors / Supplier bills).
// Land directly on Requests, the first Buy sub-page.
export default function ProcurementPage() {
  redirect("/procurement/purchase-requisitions");
}
