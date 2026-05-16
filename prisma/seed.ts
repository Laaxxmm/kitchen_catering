import { PrismaClient, Role, EmploymentType } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  // Refuse to run in production unless the operator has *explicitly*
  // opted in via SEED_DB=true. That's the documented bootstrap flow
  // (see docs/DEPLOYMENT.md) used on the very first Railway deploy.
  //
  // The guard is here to prevent accidents — someone running `npm run
  // db:seed` against a prod DATABASE_URL without realising it. It is
  // NOT meant to block the legitimate first-deploy seed, which is
  // gated by removing the SEED_DB env var after the first successful
  // deploy. The seed is idempotent (upserts), so re-runs are safe.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.SEED_DB !== "true"
  ) {
    throw new Error(
      "Seed refused: NODE_ENV=production and SEED_DB!=true. To bootstrap a fresh production database, set SEED_DB=true in the environment, run the seed, then unset SEED_DB.",
    );
  }

  // ─── Users ──────────────────────────────────────────────────────
  // Placeholder password "changeme123" — dev/bootstrap only. Real prod
  // passwords should be rotated via /admin/users immediately after the
  // first deploy completes.
  const passwordHash = await bcrypt.hash("changeme123", 12);
  const users: Array<{ email: string; name: string; role: Role }> = [
    { email: "admin@indefine.in",    name: "Admin User",      role: Role.ADMIN },
    { email: "manager@indefine.in",  name: "Manager User",    role: Role.MANAGER },
    { email: "sales@indefine.in",    name: "Sales User",      role: Role.SALES },
    { email: "store@indefine.in",    name: "Store Keeper",    role: Role.STORE_KEEPER },
    { email: "chef@indefine.in",     name: "Head Chef",       role: Role.KITCHEN_HEAD },
    { email: "delivery@indefine.in", name: "Delivery Driver", role: Role.DELIVERY },
    { email: "accounts@indefine.in", name: "Accounts User",   role: Role.ACCOUNTS },
    { email: "housekeeping@indefine.in", name: "Housekeeping Manager", role: Role.HOUSEKEEPING_MANAGER },
    { email: "maintenance@indefine.in", name: "Maintenance Manager", role: Role.MAINTENANCE_MANAGER },
  ];
  for (const u of users) {
    await db.user.upsert({
      where: { email: u.email },
      create: { ...u, passwordHash, employmentType: EmploymentType.SALARIED },
      update: {},
    });
  }

  // ─── Customers ──────────────────────────────────────────────────
  // No natural unique key on Customer; use findFirst-then-create.
  const customers = [
    { name: "Infosys",   stateCode: "29", billingAddress: "Electronic City, Bangalore" },
    { name: "Wipro",     stateCode: "29", billingAddress: "Sarjapur Road, Bangalore" },
    { name: "TCS",       stateCode: "29", billingAddress: "Whitefield, Bangalore" },
    { name: "Flipkart",  stateCode: "29", billingAddress: "Bellandur, Bangalore" },
    { name: "Razorpay",  stateCode: "29", billingAddress: "Koramangala, Bangalore" },
  ];
  for (const c of customers) {
    const existing = await db.customer.findFirst({ where: { name: c.name } });
    if (!existing) await db.customer.create({ data: c });
  }

  // ─── Ingredients ────────────────────────────────────────────────
  const ingredients = [
    { sku: "ING-001", name: "Paneer",         unit: "kg", category: "Dairy" },
    { sku: "ING-002", name: "Basmati rice",   unit: "kg", category: "Grocery" },
    { sku: "ING-003", name: "Chicken breast", unit: "kg", category: "Meat" },
    { sku: "ING-004", name: "Onion",          unit: "kg", category: "Vegetables" },
    { sku: "ING-005", name: "Garam masala",   unit: "g",  category: "Spices" },
  ];
  for (const i of ingredients) {
    await db.ingredient.upsert({
      where: { sku: i.sku },
      create: i,
      update: {},
    });
  }

  // ─── Dishes ─────────────────────────────────────────────────────
  const dishes = [
    { code: "DSH-001", name: "Paneer Butter Masala", unitPrice: 180, gstRatePct: 5 },
    { code: "DSH-002", name: "Chicken Biryani",      unitPrice: 250, gstRatePct: 5 },
    { code: "DSH-003", name: "Veg Pulao",            unitPrice: 150, gstRatePct: 5 },
    { code: "DSH-004", name: "Dal Tadka",            unitPrice:  90, gstRatePct: 5 },
    { code: "DSH-005", name: "Roti (per piece)",     unitPrice:  15, gstRatePct: 5 },
  ];
  for (const d of dishes) {
    await db.dish.upsert({
      where: { code: d.code },
      create: d,
      update: {},
    });
  }

  // ─── Vendor ─────────────────────────────────────────────────────
  await db.vendor.upsert({
    where: { code: "V-0001" },
    create: { code: "V-0001", name: "Bangalore Wholesale Suppliers", stateCode: "29" },
    update: {},
  });

  // ─── Settings ───────────────────────────────────────────────────
  // Recipe suggestions OFF by default until kitchen team validates them
  // (PRD §4.5). Default ingredient wastage % used by recipe-cost rollups.
  await db.settings.upsert({
    where: { key: "recipe.suggestionsEnabled" },
    create: { key: "recipe.suggestionsEnabled", value: false },
    update: {},
  });
  await db.settings.upsert({
    where: { key: "recipe.defaultWastagePercent" },
    create: { key: "recipe.defaultWastagePercent", value: 5 },
    update: {},
  });

  console.log("Seed done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
