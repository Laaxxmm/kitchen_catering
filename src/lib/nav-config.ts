import type { IconName } from "@/components/ik/Icon";

// Top-level nav groups. Labels are display-only — the `href`s are the
// existing routes, unchanged (e.g. "Menu" → /dishes, "Kitchen stock" →
// /inventory, "Invoices" → /invoices). `badgeKey` ties a group to a
// "needs-you" count from getNavBadges(); groups without one carry no badge.

export interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  href: string;
}

export type BadgeKey = "sell" | "make" | "stores" | "buy" | "money";

export type NavBadge = { count: number; tone: "red" | "amber" };
export type NavBadges = Partial<Record<BadgeKey, NavBadge>>;

export interface NavGroup {
  key: string;
  /** Header label; null = render items flush with no collapsible header. */
  label: string | null;
  collapsible: boolean;
  badgeKey?: BadgeKey;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "home",
    label: null,
    collapsible: false,
    items: [
      { key: "dashboard", label: "Home", icon: "home", href: "/dashboard" },
      { key: "tasks", label: "Tasks", icon: "report", href: "/tasks" },
    ],
  },
  {
    key: "sell",
    label: "Sell",
    collapsible: true,
    badgeKey: "sell",
    items: [
      { key: "orders", label: "Orders", icon: "folder", href: "/orders" },
      { key: "quotes", label: "Quotes", icon: "quote", href: "/quotes" },
      { key: "customers", label: "Customers", icon: "building", href: "/customers" },
      { key: "dishes", label: "Menu", icon: "report", href: "/dishes" },
    ],
  },
  {
    key: "make",
    label: "Make & deliver",
    collapsible: true,
    badgeKey: "make",
    items: [
      { key: "kitchen", label: "Kitchen", icon: "briefcase", href: "/kitchen" },
      { key: "requisitions", label: "Requisitions", icon: "report", href: "/requisitions" },
      // Hired casual labour: chef / F&B raise it, the manager approves it.
      // Sits with the other "what this event needs" requests, not under
      // Money — accounts reach the payable ones from the list itself.
      { key: "manpower", label: "Manpower", icon: "user", href: "/manpower" },
      { key: "deliveries", label: "Deliveries", icon: "truck", href: "/deliveries" },
    ],
  },
  {
    key: "stores",
    label: "Stores",
    collapsible: true,
    badgeKey: "stores",
    items: [
      { key: "inventory", label: "Kitchen stock", icon: "box", href: "/inventory" },
      { key: "banquet", label: "Banquet", icon: "box", href: "/banquet" },
    ],
  },
  // Housekeeping and maintenance are self-run departments, not stores: each
  // has its own stock, its own stock requests and its own head. The heads
  // see their whole department here; admin / manager see the overview, the
  // requests waiting on them and the go-live upload (see role-nav.ts).
  {
    key: "housekeepingdept",
    label: "Housekeeping",
    collapsible: true,
    items: [
      { key: "housekeeping", label: "Overview", icon: "box", href: "/housekeeping" },
      { key: "hk-jobs", label: "Jobs", icon: "kanban", href: "/housekeeping/jobs" },
      { key: "hk-stock", label: "Stock", icon: "box", href: "/housekeeping/items" },
      { key: "hk-issues", label: "Issue to room", icon: "truck", href: "/housekeeping/issues" },
      { key: "hk-returns", label: "Returns", icon: "refresh", href: "/housekeeping/returns" },
      { key: "hk-purchase", label: "Stock requests", icon: "invoice", href: "/housekeeping/purchase" },
      { key: "hk-upload", label: "Upload stock", icon: "upload", href: "/housekeeping/upload" },
      { key: "hk-rooms", label: "Rooms", icon: "building", href: "/housekeeping/rooms" },
      { key: "hk-staff", label: "Staff", icon: "user", href: "/housekeeping/staff" },
      { key: "hk-reports", label: "Reports", icon: "report", href: "/housekeeping/reports" },
    ],
  },
  {
    key: "maintenancedept",
    label: "Maintenance",
    collapsible: true,
    items: [
      { key: "maintenance", label: "Overview", icon: "briefcase", href: "/maintenance" },
      { key: "mt-jobs", label: "Jobs", icon: "wrench", href: "/maintenance/activities" },
      { key: "mt-stock", label: "Stock", icon: "box", href: "/maintenance/items" },
      { key: "mt-purchase", label: "Stock requests", icon: "invoice", href: "/maintenance/purchase" },
      { key: "mt-upload", label: "Upload stock", icon: "upload", href: "/maintenance/upload" },
      // The room master is housekeeping's; maintenance reads it.
      { key: "mt-rooms", label: "Rooms", icon: "building", href: "/housekeeping/rooms" },
      { key: "mt-staff", label: "Staff", icon: "user", href: "/maintenance/staff" },
      { key: "mt-reports", label: "Reports", icon: "report", href: "/maintenance/reports" },
    ],
  },
  {
    key: "buy",
    label: "Buy",
    collapsible: true,
    badgeKey: "buy",
    items: [
      // Purchase requisitions removed — the store now raises a PO directly
      // from a chef-requisition shortfall (no separate request document).
      { key: "purchaseorders", label: "Purchase orders", icon: "invoice", href: "/procurement/purchase-orders" },
      { key: "vendors", label: "Vendors", icon: "building", href: "/procurement/vendors" },
      { key: "supplierbills", label: "Supplier bills", icon: "invoice", href: "/procurement/vendor-bills" },
    ],
  },
  {
    key: "money",
    label: "Money",
    collapsible: true,
    badgeKey: "money",
    items: [
      { key: "roomservicebills", label: "Room billing", icon: "invoice", href: "/invoices/room-service" },
      { key: "invoices", label: "Invoices", icon: "invoice", href: "/invoices" },
      { key: "payments", label: "Payments", icon: "pie", href: "/payments" },
      { key: "pettycash", label: "Petty cash", icon: "pie", href: "/petty-cash" },
      { key: "salary", label: "Salary", icon: "user", href: "/salary" },
      { key: "reports", label: "Reports", icon: "report", href: "/reports" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    collapsible: true,
    items: [
      { key: "admin", label: "Users & settings", icon: "user", href: "/admin" },
    ],
  },
];
