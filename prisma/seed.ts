import { PrismaClient, Role, EmploymentType } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  // Refuse to run in production. See docs/SECURITY.md §2.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Seed script must never run in production. Use the one-time `setup` script to create the first ADMIN.",
    );
  }

  // ─── Users ──────────────────────────────────────────────────────
  // Placeholder password "changeme123" — dev-only. The seed refuses to run
  // when NODE_ENV=production (guard above). Real prod admins are created
  // by the one-time setup script with a strong password.
  const passwordHash = await bcrypt.hash("changeme123", 12);
  const users: Array<{ email: string; name: string; role: Role }> = [
    { email: "admin@indefine.in",    name: "Admin User",      role: Role.ADMIN },
    { email: "manager@indefine.in",  name: "Manager User",    role: Role.MANAGER },
    { email: "sales@indefine.in",    name: "Sales User",      role: Role.SALES },
    { email: "store@indefine.in",    name: "Store Keeper",    role: Role.STORE_KEEPER },
    { email: "chef@indefine.in",     name: "Head Chef",       role: Role.KITCHEN_HEAD },
    { email: "delivery@indefine.in", name: "Delivery Driver", role: Role.DELIVERY },
    { email: "accounts@indefine.in", name: "Accounts User",   role: Role.ACCOUNTS },
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
