import { redirect } from "next/navigation";

// The Inventory module has three sub-areas (ingredients / receipts / issues).
// Land directly on the ingredient master since that's the daily-use surface.
export default function InventoryPage() {
  redirect("/inventory/ingredients");
}
