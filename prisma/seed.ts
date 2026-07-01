import { PrismaClient, Role, EmploymentType, MaintenanceCategory } from "@prisma/client";
import bcrypt from "bcryptjs";
import { dishSeed } from "./seed-data/dishes";
import {
  maintenanceItemSeed,
  ingredientSeed as storeIngredientSeed,
  housekeepingItemSeed,
} from "./seed-data/stores";

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
    // F&B Service is one merged role (internally DELIVERY). Two sample users.
    { email: "delivery@indefine.in", name: "F&B Service (Delivery)", role: Role.DELIVERY },
    { email: "accounts@indefine.in", name: "Accounts User",   role: Role.ACCOUNTS },
    { email: "housekeeping@indefine.in", name: "Housekeeping Manager", role: Role.HOUSEKEEPING_MANAGER },
    { email: "maintenance@indefine.in", name: "Maintenance Manager", role: Role.MAINTENANCE_MANAGER },
    { email: "fnb@indefine.in",         name: "F&B Service",          role: Role.DELIVERY },
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
  // A few original demo dishes (kept for existing orders that reference
  // them) + the full client menu imported from prisma/seed-data/dishes.ts
  // (room-service Excel → SERVICE menu, banquet DOCX → BANQUET menu).
  const demoDishes = [
    { code: "DSH-001", name: "Paneer Butter Masala", unitPrice: 180, gstRatePct: 5 },
    { code: "DSH-002", name: "Chicken Biryani",      unitPrice: 250, gstRatePct: 5 },
    { code: "DSH-003", name: "Veg Pulao",            unitPrice: 150, gstRatePct: 5 },
    { code: "DSH-004", name: "Dal Tadka",            unitPrice:  90, gstRatePct: 5 },
    { code: "DSH-005", name: "Roti (per piece)",     unitPrice:  15, gstRatePct: 5 },
  ];
  for (const d of demoDishes) {
    await db.dish.upsert({ where: { code: d.code }, create: d, update: {} });
  }
  // Client menu — idempotent on the generated code (SVC-/BNQ-/BOTH-####).
  for (const d of dishSeed) {
    await db.dish.upsert({
      where: { code: d.code },
      create: {
        code: d.code,
        name: d.name,
        category: d.category,
        menu: d.menu,
        unitPrice: d.unitPrice,
        description: d.description,
        gstRatePct: 5,
      },
      // Refresh menu/category/price on re-seed so a corrected source
      // file propagates; leave everything else (e.g. manual edits) alone.
      update: {
        category: d.category,
        menu: d.menu,
        unitPrice: d.unitPrice,
        description: d.description,
      },
    });
  }

  // ─── Store inventory (kitchen Ingredient master) ─────────────────
  // 136 products from "Store Inventory On Daily Basis.xlsx" with opening
  // qty + rate. Idempotent on sku (STR-####). onHandQty / avgUnitCost
  // seed from the opening values so stock shows up immediately.
  for (const i of storeIngredientSeed) {
    await db.ingredient.upsert({
      where: { sku: i.sku },
      create: {
        sku: i.sku,
        name: i.name,
        unit: i.unit,
        openingQty: i.openingQty,
        openingAvgCost: i.openingAvgCost,
        onHandQty: i.openingQty,
        avgUnitCost: i.openingAvgCost,
        gstRatePct: 5,
      },
      // Don't clobber live on-hand on re-seed — only refresh display
      // metadata (unit). Stock movements own onHandQty after first seed.
      update: { unit: i.unit },
    });
  }

  // ─── Maintenance store items ─────────────────────────────────────
  // 35 electrical / plumbing spares from "Maintainance Materials.xlsx".
  // Idempotent on name (MaintenanceItem @@unique([name])).
  for (const m of maintenanceItemSeed) {
    const existing = await db.maintenanceItem.findUnique({ where: { name: m.name } });
    if (!existing) {
      await db.maintenanceItem.create({
        data: {
          name: m.name,
          unit: m.unit,
          category: m.category as MaintenanceCategory,
        },
      });
    }
  }

  // ─── Housekeeping items ──────────────────────────────────────────
  // 34 items from the client's HK Requirement sheet. Idempotent on name.
  for (const h of housekeepingItemSeed) {
    const existing = await db.housekeepingItem.findUnique({ where: { name: h.name } });
    if (!existing) {
      await db.housekeepingItem.create({
        data: { name: h.name, unit: h.unit },
      });
    }
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

  // ─── Banquet store packaging (Phase 3) ──────────────────────────
  // 44 SKUs from the client's "FnB Store's Report On Daily Basis" Excel.
  // Idempotent: keyed on item name (unique constraint in schema).
  const banquetItems: Array<{ name: string; category: string; unit: string }> = [
    { name: "Ripple Tea Cups [100 ml]",                       category: "Packaging",  unit: "pcs" },
    { name: "Ripple Water Cups [200 ml]",                     category: "Packaging",  unit: "pcs" },
    { name: "Printed Tissue Paper",                           category: "Tissue",     unit: "Bag" },
    { name: "Tissue Paper [Without Print]",                   category: "Tissue",     unit: "Bag" },
    { name: "5 Compartment Meal Tray",                        category: "Trays",      unit: "Pcs" },
    { name: "3 Compartment Meal Tray [10.5 inch]",            category: "Trays",      unit: "Pcs" },
    { name: "Baggase Plates Round [7 inch]",                  category: "Plates",     unit: "Pcs" },
    { name: "Tomato Ketchup [1/2 kg]",                        category: "Condiments", unit: "Pkt" },
    { name: "Butter Paper",                                   category: "Packaging",  unit: "Roll" },
    { name: "Round Printed Logo Sticker",                     category: "Stickers",   unit: "Sheets" },
    { name: "Printed Square Logo Sticker",                    category: "Stickers",   unit: "Pcs" },
    { name: "Table Roll",                                     category: "Packaging",  unit: "Roll" },
    { name: "Cling Wrap",                                     category: "Packaging",  unit: "Roll" },
    { name: "Windsor 8 Compartment Box",                      category: "Boxes",      unit: "Pcs" },
    { name: "Windsor 5 Compartment Box",                      category: "Boxes",      unit: "Pcs" },
    { name: "Wooden Spoon [16 MM]",                           category: "Cutlery",    unit: "Pcs" },
    { name: "Wooden Fork [16 MM]",                            category: "Cutlery",    unit: "Pcs" },
    { name: "Plastic Containers [500 ml]",                    category: "Containers", unit: "Pcs" },
    { name: "Plastic Containers [100 ml]",                    category: "Containers", unit: "Pcs" },
    { name: "Cello Tape [1 inch]",                            category: "Tape",       unit: "Roll" },
    { name: "Brown Tape [2.5 inch]",                          category: "Tape",       unit: "Roll" },
    { name: "Double Tape",                                    category: "Tape",       unit: "Roll" },
    { name: "Seal Dispenser",                                 category: "Tools",      unit: "Pcs" },
    { name: "Cello Tape [2.5 inch]",                          category: "Tape",       unit: "Roll" },
    { name: "Aluminium Paper Plates [7 inch]",                category: "Plates",     unit: "Pcs" },
    { name: "Baggse Bowl [250 ml]",                           category: "Bowls",      unit: "Pcs" },
    { name: "Baggase Bowl [150 ml]",                          category: "Bowls",      unit: "Pcs" },
    { name: "Fomex Bowl [350 ml]",                            category: "Bowls",      unit: "Pcs" },
    { name: "White Cake Box [9*8*4]",                         category: "Boxes",      unit: "Pcs" },
    { name: "Brown Cake Box [9*8*4]",                         category: "Boxes",      unit: "Pcs" },
    { name: "3 cp Areca Plates [10 inch]",                    category: "Plates",     unit: "Pcs" },
    { name: "Brown Paper Bag",                                category: "Packaging",  unit: "Pcs" },
    { name: "Aluminium Foil",                                 category: "Packaging",  unit: "Roll" },
    { name: "Hair Net",                                       category: "Hygiene",    unit: "pouch" },
    { name: "Burger Clam Shell [6*6]",                        category: "Boxes",      unit: "pcs" },
    { name: "Burger Clam Shell [9*9]",                        category: "Boxes",      unit: "Pcs" },
    { name: "Sandwich Clam Shell",                            category: "Boxes",      unit: "Pcs" },
    { name: "Fuel",                                           category: "Other",      unit: "Pcs" },
    { name: "Corn Starch 8 CP Meal Box",                      category: "Boxes",      unit: "Pcs" },
    { name: "Disposable Plastic Juice Cups with lid [300 ml]", category: "Cups",      unit: "Pcs" },
    { name: "Plastic Container [750 ml]",                     category: "Containers", unit: "Pcs" },
    { name: "Paper Straw [8 mm]",                             category: "Cutlery",    unit: "Pkt" },
    { name: "Black Hand Gloves",                              category: "Hygiene",    unit: "Pouch" },
    { name: "Ketchup Sachet",                                 category: "Condiments", unit: "Pkt" },
  ];
  for (const item of banquetItems) {
    await db.banquetItem.upsert({
      where: { name: item.name },
      create: item,
      update: {}, // don't overwrite category/unit/stock if it already exists
    });
  }

  // ─── Customers (client import) ───────────────────────────────────
  // 14 customers from "CX billing Details.xlsx". Idempotent: keyed on
  // (name, gstin) which matches the schema's @@unique constraint.
  // Most entries are IISc departments sharing one GSTIN (29AAATI1501J2ZV);
  // each department keeps its own Customer row + billing address.
  type CustomerImport = {
    name: string;
    gstin: string | null;
    stateCode: string;
    billingAddress: string;
    creditDays: number;
    notes: string | null;
  };
  const customerImports: CustomerImport[] = [
    { name: "IISc — Department of Electronic Systems Engineering",  gstin: "29AAATI1501J2ZV", stateCode: "29", billingAddress: "The Chairman\nDepartment of Electronic Systems Engineering\nIndian Institute of Science\nBangalore 560003",                                  creditDays: 45, notes: "Their vendor code for us: 2000010609\nPayment terms: 45 days" },
    { name: "IISc — Centre For Nano Science",                       gstin: "29AAATI1501J2ZV", stateCode: "29", billingAddress: "IISC\nThe Chairman\nCentre For Nano Science",                                                                                                  creditDays: 45, notes: "Their vendor code for us: 2000010609\nPayment terms: 45 days" },
    { name: "IISc — Dept of CSA",                                   gstin: "29AAATI1501J2ZV", stateCode: "29", billingAddress: "The Chair\nDept of CSA\nIISc",                                                                                                                creditDays: 45, notes: "Their vendor code for us: 2000010609\nPayment terms: 45 days" },
    { name: "UltraTech Cement Limited",                             gstin: "29AAACL6442L1Z6", stateCode: "29", billingAddress: "UltraTech Cement Limited\nNo.5, Embassy Links, SRT Road,\nCunningham Road, Vasanth Nagar,\nBangalore - 560052",                                creditDays: 0,  notes: null },
    { name: "Foundation For Science Innovation and Development",    gstin: "29AAECF1802E1Z1", stateCode: "29", billingAddress: "The Director\nFoundation For Science Innovation and Development\nInnovation Centre\nIndian Institute of Science\nBengaluru 560012",          creditDays: 0,  notes: null },
    { name: "PricewaterhouseCoopers Private Limited",               gstin: "29AABCP9181H2ZZ", stateCode: "29", billingAddress: "PRICEWATERHOUSECOOPERS PRIVATE LIMITED\n5th Floor, Tower D, The Millenia,\n1 & 2 Murphy Road, Ulsoor,\nBengaluru Urban, Karnataka — 560008",  creditDays: 0,  notes: null },
    { name: "Orbit AID Aerospace Pvt Ltd",                          gstin: "29AADCO5318H1ZC", stateCode: "29", billingAddress: "Orbit AID Aerospace Pvt Ltd\n4th Floor, Raj Kasthuri Building,\n86/C-1, 3rd Main Road,\nIndustrial Sub Urb 2nd Stage,\nYeshwanthpur, Bengaluru - 560022", creditDays: 0,  notes: null },
    { name: "IISc — CAOS Department",                               gstin: "29AAATI1501J2ZV", stateCode: "29", billingAddress: "The Chair\nCAOS Department\nIISC Campus",                                                                                                     creditDays: 0,  notes: "Their vendor code for us: 2000010609" },
    { name: "IISc — Divecha Centre For Climate Change",             gstin: "29AAATI1501J2ZV", stateCode: "29", billingAddress: "The Chair\nDivecha Centre For Climate Change\nIISC, Bangalore",                                                                              creditDays: 0,  notes: "Their vendor code for us: 2000010609" },
    { name: "IISc — Dept of Chemical Engineering",                  gstin: "29AAATI1501J2ZV", stateCode: "29", billingAddress: "The Chair,\nDept of Chemical Engineering\nIISC, Bangalore",                                                                                  creditDays: 45, notes: "Their vendor code for us: 2000010609\nPayment terms: 45 days" },
    { name: "Land Optimizer International Pvt Ltd",                 gstin: "29AAICR7308H1Z2", stateCode: "29", billingAddress: "Land Optimizer International Pvt Ltd\nE-59, 1st Main, 5th Cross,\nManyata Residency, Manyata Tech Park,\nNagawara, Bangalore - 560045",      creditDays: 0,  notes: null },
    { name: "Travelstack Tech Limited",                             gstin: "29AAFCC6416Q1Z2", stateCode: "29", billingAddress: "TRAVELSTACK TECH LIMITED\n36/5, Somasandra Palya, Sector-2,\nHSR Layout, Haralakunte Village,\nBengaluru Urban, Karnataka - 560102",          creditDays: 0,  notes: null },
    { name: "MS Ramaiah University of Applied Sciences",            gstin: "29AADAM2496A1ZN", stateCode: "29", billingAddress: "The Registrar\nMS Ramaiah University of Applied Sciences\nUniversity House, Gnanagangothri Campus,\nMSR Nagar, New BEL Road",                creditDays: 0,  notes: null },
    { name: "Ramaiah University — Dept of Phycology",               gstin: null,              stateCode: "29", billingAddress: "Dept of Phycology\nRamaiah University of Applied Sciences\nBangalore",                                                                       creditDays: 0,  notes: null },
  ];
  for (const c of customerImports) {
    // @@unique([name, gstin]) — upsert by composite key. When gstin is
    // null Prisma's composite-unique upsert won't match (nulls aren't
    // equal in unique constraints), so we fall back to a findFirst.
    if (c.gstin === null) {
      const existing = await db.customer.findFirst({
        where: { name: c.name, gstin: null },
      });
      if (!existing) {
        await db.customer.create({
          data: {
            name: c.name,
            gstin: null,
            stateCode: c.stateCode,
            billingAddress: c.billingAddress,
            creditDays: c.creditDays,
            notes: c.notes,
          },
        });
      }
      continue;
    }
    await db.customer.upsert({
      where: { name_gstin: { name: c.name, gstin: c.gstin } },
      create: {
        name: c.name,
        gstin: c.gstin,
        stateCode: c.stateCode,
        billingAddress: c.billingAddress,
        creditDays: c.creditDays,
        notes: c.notes,
      },
      update: {},
    });
  }

  // ─── Vendors (client import) ─────────────────────────────────────
  // 35 vendors from "Vendor details.xlsx". Idempotent — keyed on the
  // vendor name (Vendor has no unique constraint on name in the
  // schema, so we do findFirst-then-create to match the customer
  // pattern). Codes are minted via the VendorCodeSequence so they
  // continue from wherever previous deploys left off.
  type VendorImport = {
    name: string;
    gstin: string | null;
    stateCode: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    msme: boolean;
    notes: string | null;
  };
  const vendorImports: VendorImport[] = [
    { name: "Sree Chandrashekar Enterprises", gstin: "29AYCPB3104A1ZC", stateCode: "29", phone: "9060100074 / 7019302221",                  email: null,                                       address: "No. 32, S.D. Lane, Akkipet 3rd Cross, Bangalore - 560053",                                                                       msme: false, notes: "Bank: Canara Bank · A/C 0406201015790 · IFSC CNRB0000406" },
    { name: "SN Marketing",                   gstin: "29ADRFS6358M1ZX", stateCode: "29", phone: "8197134657",                              email: null,                                       address: "21st Main, 17th Cross Road, Siddanna Layout, Banashankari Stage II, Bengaluru - 560070",                                          msme: false, notes: "Bank: Canara Bank · A/C 0408201004033 · IFSC CNRB0000408" },
    { name: "SN Celebration",                 gstin: "29AAFFT6477K1ZE", stateCode: "29", phone: "8197134657",                              email: null,                                       address: "602, Ground Floor, S N Celebration, 24th Cross Road, Bengaluru Urban - 560070",                                                  msme: false, notes: "Bank: Canara Bank · A/C 120025000198 · IFSC CNRB0000408" },
    { name: "V Care Pest Management Service", gstin: "29NOJPS4276G1Z0", stateCode: "29", phone: "7975235226 / 8951735226",                  email: "vcaresan76@gmail.com",                     address: "#93, Lakkappa Layout, Medi Agarahara, Yelahanka Hobli, Bangalore - 560064",                                                      msme: false, notes: "Bank: Karnataka Bank · A/C 9752000100016901 · IFSC KARB0000975" },
    { name: "R K Enterprises",                gstin: "29ADVPR6563M1ZA", stateCode: "29", phone: "9886128498 / 9035341666",                  email: null,                                       address: "#52, 2nd Cross, Pampanagar Main Road, Near Railway Ground, Yeshwanthpur, Bangalore - 560022",                                     msme: false, notes: null },
    { name: "Sanjay Farms Products",          gstin: "29AMCPM9917E1ZS", stateCode: "29", phone: "9686717860 / 9686727860",                  email: null,                                       address: "SFP 157, Ground Floor, Katteramma Temple Street, Doddabommasandra, Vidyaranyapura Post, Bangalore - 560097",                     msme: false, notes: "Bank: HDFC Bank · A/C 50200025188028 · IFSC HDFC0004076" },
    { name: "Eshwar Traders",                 gstin: "29AACFE5188K1ZY", stateCode: "29", phone: "9845104543",                              email: null,                                       address: "#10, GF2, 2nd Main Road, New Tharagupet",                                                                                         msme: false, notes: null },
    { name: "White and Brown Bake Works",     gstin: "29AHRPT2066P1Z8", stateCode: "29", phone: "9739780005",                              email: "info@crumbles.in",                         address: "6/9, M C S Industrial Layout, Nageswara Naganahalli, Dr. S.R.K. Nagar Post, Bangalore, Karnataka - 560077",                       msme: false, notes: "Bank: Yes Bank · A/C 015663400001271 · IFSC YESB0000156" },
    { name: "Arna Dairy Farm Private Limited",gstin: "29AAVCA0901E1ZR", stateCode: "29", phone: "9148916916 / 9148111137",                  email: "arnadairy@yahoo.com",                      address: "No. 80/2 & 80/3, Kyalasanahalli, K.R. Puram, Bangalore - 560077",                                                                msme: false, notes: null },
    { name: "Mathru Gas Co",                  gstin: "29ABMFM7544C1ZZ", stateCode: "29", phone: null,                                      email: null,                                       address: "Sanjaynagar Main Road, Nagashettyhalli, Bengaluru - 560094",                                                                     msme: false, notes: "Bank: Bank of India · A/C 849320110000537 · IFSC BKID0008493" },
    { name: "Dheer Hospitality India Pvt Ltd",gstin: "29AADCD8615J1ZC", stateCode: "29", phone: "7760633991 / 8088170437",                  email: null,                                       address: "No. 13/2, 12 & 13th A Cross, 02nd Block, 13th Cross, Thyagaraja Nagar, Bangalore - 560028",                                       msme: true,  notes: "Bank: ICICI Bank · A/C 193751000013 · IFSC ICIC0001937\nMSME ref: KR03E0162671" },
    { name: "Sri Sai Enterprises",            gstin: "29AJWPB2121L1Z0", stateCode: "29", phone: "9945028757 / 9036949106",                  email: null,                                       address: "#531, Ground Floor, 13th A Cross, Vyalikaval, Near Ayyappa Temple, Malleshwaram, Bangalore - 560003",                            msme: false, notes: "Bank: Canara Bank · A/C 125001590438 · IFSC CNRB0000787" },
    { name: "RMC (Sri Lakshmi Saraswathi)",   gstin: "29AJWPB2121L1Z0", stateCode: "29", phone: "9448575426 / 9844810008",                  email: null,                                       address: "156/1, 5th Main, 3rd Cross, APMC Yard, Yeshwanthpur, Bangalore - 560022",                                                         msme: false, notes: null },
    { name: "St. Joseph Traders",             gstin: "29AFSPB3173N1ZV", stateCode: "29", phone: "9108311540",                              email: null,                                       address: "No. 44/21, 5th Main Road, A.P.M.C. Yard, Yeshwanthpur, Bangalore",                                                                msme: false, notes: "Bank: Canara Bank · A/C 125001590438 · IFSC CNRB0000787" },
    { name: "Access Systems and Solutions LLP", gstin: "33ABQFA1306G1ZU", stateCode: "33", phone: "9884261870",                            email: null,                                       address: "No. 10, Anna Street, Chitlapakkam, Chennai - 600064",                                                                            msme: false, notes: "Bank: ICICI Bank · A/C 103905003518 · IFSC ICIC0001039" },
    { name: "Gupta Laundromats Private Ltd",  gstin: "29AAICG0126A1Z5", stateCode: "29", phone: null,                                      email: null,                                       address: "No. 33, 9th Main Road, Duggalamma Layout, Peenya Industrial Area, Bangalore",                                                     msme: false, notes: null },
    { name: "Phitons Bioengineering Pvt Ltd", gstin: "29AAICC5331M2ZA", stateCode: "29", phone: null,                                      email: null,                                       address: "5th Floor, Sona Towers, No. 71/2, Millers Road, Bangalore - 560052",                                                              msme: false, notes: "Bank: Axis Bank · A/C 925030030895611 · IFSC UTIB0001541" },
    { name: "Rayar Agencies",                 gstin: "29AUUPR7909K1ZG", stateCode: "29", phone: "9952663691",                              email: null,                                       address: "No. 1/10, 8th Main, Muthyala Nagar, Opp. Nandish Park Apartment, Bengaluru - 560054",                                             msme: false, notes: "Bank: ICICI Bank · A/C 233605000449 · IFSC ICIC0002336" },
    { name: "Sri Veerabhadreshwara Provision Stores", gstin: null,      stateCode: "29", phone: null,                                      email: null,                                       address: "No. 112, Ashwanthnagar, Sanjaynagar Main Road, RMV 2nd Stage, Bangalore - 560094",                                                msme: false, notes: "Unregistered (no GST)" },
    { name: "Vigneshwara Enterprises",        gstin: "29BTBPP9404Q1ZW", stateCode: "29", phone: "9845373403 / 9341201020",                  email: "vigneshwaraenterprises.2011@gmail.com",    address: "#46, Sai Enclave, Agrahara Village, Yelahanka Hobli, Bangalore - 560064",                                                          msme: false, notes: "Bank: Bank of Baroda · A/C 89590500000036 · IFSC BARB0VJHBRL" },
    { name: "Sree Annapurna Trading Company", gstin: "29BKUPD6535Q1Z5", stateCode: "29", phone: "9110299304",                              email: "annapurnasree.t.c@gmail.com",              address: "Ground Floor, No. 21, 5th Street, Jogupalyam, Halasuru, Bengaluru Urban - 560008",                                                msme: false, notes: null },
    { name: "S K Enterprises (Fuel Tin)",     gstin: "29ABWPH2761C1ZG", stateCode: "29", phone: "8139910801",                              email: "skehanat@gmail.com",                       address: "#46, Markham Road, H 3rd Street, Ashok Nagar, Bangalore - 560025",                                                                msme: false, notes: "Bank: Kotak Mahindra Bank · A/C 9746343228 · IFSC KKBK0008122" },
    { name: "Classic Screens",                gstin: "29AENPC1706Q2Z3", stateCode: "29", phone: "9845334924 / 8197403247 / 9110226140",     email: "classicscreensgrc@gmail.com",              address: "#15, 3rd Cross, Pipeline Road, Basappa Garden, Malleshwaram, Bangalore - 560003",                                                  msme: false, notes: "Bank: Indian Overseas Bank · A/C 119302000001855" },
    { name: "AK Enterprises",                 gstin: null,              stateCode: "29", phone: null,                                      email: null,                                       address: null,                                                                                                                            msme: false, notes: "Unregistered (no GST)" },
    { name: "R K Enterprises (Ice Creams)",   gstin: "29AAOFR1562L2ZK", stateCode: "29", phone: "8050586505 / 8884629777",                  email: "rkenterprisesmlr@gmail.com",               address: "Site No. 31, Sy No. 33, Byrappa Garden, Doddabommasandra, Ramachandrapura, Bangalore Urban - 560013",                              msme: false, notes: "Bank: Canara Bank · A/C 01051010002496" },
    { name: "Mahadev Traders",                gstin: "29BPDPC5495N1ZA", stateCode: "29", phone: "8892606903",                              email: "mahadevtraders2017@gmail.com",             address: "#1065/33, Ground Floor, 4th Main, Triveni Road, Near M.S. Ramaiah Bus Stop, Gokula 1st Stage, 2nd Phase, Mathikere",               msme: false, notes: "Bank: Punjab National Bank" },
    { name: "Bismilla Chicken Center",        gstin: null,              stateCode: "29", phone: "9343506562 / 7022919996 / 9740590755",     email: null,                                       address: "No. 223, Shop No. 4, 5th A Cross, Jakkur Road, Bangalore - 560064",                                                                msme: false, notes: "Unregistered (no GST)" },
    { name: "JK Tent House",                  gstin: null,              stateCode: "29", phone: "9108698460",                              email: null,                                       address: "No. 170/2, Bus Stand, Nagashettyhalli, Bangalore - 560094",                                                                       msme: false, notes: "Unregistered (no GST)" },
    { name: "Royal Electricals & Electronics",gstin: "29GPWPS3789P1Z1", stateCode: "29", phone: "8296730238",                              email: null,                                       address: "255, A.E.C.S. Layout, Sanjay Nagar Main Road, Ashwanth Nagar, Bangalore - 560094",                                                msme: false, notes: "Bank: Union Bank of India · A/C 510101006335946 · IFSC UBIN0911739" },
    { name: "Goldkraft Enterprises",          gstin: "29BOZPK4630N1ZZ", stateCode: "29", phone: "9449065735",                              email: "sales@goldkraft.in",                       address: "No. 18, 6th Main, 4th Cross, Gandhi Nagar, Bengaluru - 560009",                                                                  msme: true,  notes: "Bank: HDFC Bank · A/C 5020046491625 · IFSC HDFC0004697\nMSME ref: UDYAM-KR-03-0087817" },
    { name: "Nanda Security Services",        gstin: null,              stateCode: "29", phone: "9980734020 / 9880369614",                  email: "nandass2017@gmail.com",                    address: "#B 74, Pipeline Road, 5th A Main Road, Bahubalinagar, Jalahalli Post, Bangalore - 560013",                                         msme: false, notes: "Bank: Karnataka Bank · A/C 1152500102380201\nUnregistered (no GST)" },
    { name: "Vivan World Wides",              gstin: "29BIBPR9605L1ZN", stateCode: "29", phone: "6364239756",                              email: "vivanworldwides@gmail.com",                address: "No. 1040, New No. 51, 3rd Cross, 2nd Main, K N Extension, Bengaluru",                                                              msme: false, notes: "Bank: IndusInd Bank · A/C 253622226666 · IFSC INDB0001589" },
    { name: "Agrileaf Exports Pvt Ltd",       gstin: "29AASCA1885E1Z9", stateCode: "29", phone: null,                                      email: null,                                       address: "2/63, Barangaya Compound, Nidle Post, Belthangady Taluk, Dakshina Kannada",                                                       msme: false, notes: "Bank: State Bank of India · A/C 39101685811 · IFSC SBIN0003356" },
    { name: "Hi-Dream Reliable Team (Agency)",gstin: "29AYMPN4782A1Z4", stateCode: "29", phone: null,                                      email: null,                                       address: null,                                                                                                                            msme: false, notes: "Bank: HDFC Bank · A/C 50200100194286 · IFSC HDFC0004057" },
    { name: "Noori Traders",                  gstin: "29AAQFN4390Q1Z5", stateCode: "29", phone: "9008614348",                              email: null,                                       address: "5th Main Road, Sachindananda Nagar, Raj Mahal Vilas 2nd Stage, Sanjaynagar, Bengaluru",                                            msme: false, notes: null },
  ];
  // Codes auto-allocated per insert. Find the current high-water mark.
  const currentHighest = await db.vendor.findFirst({
    orderBy: { code: "desc" },
    select: { code: true },
  });
  let nextCodeN =
    currentHighest && /^V-(\d+)$/.exec(currentHighest.code)
      ? Number(/^V-(\d+)$/.exec(currentHighest.code)![1]) + 1
      : 1;
  for (const v of vendorImports) {
    const existing = await db.vendor.findFirst({ where: { name: v.name } });
    if (existing) continue;
    const code = `V-${String(nextCodeN).padStart(4, "0")}`;
    nextCodeN += 1;
    await db.vendor.create({
      data: {
        code,
        name: v.name,
        gstin: v.gstin,
        stateCode: v.stateCode,
        phone: v.phone,
        email: v.email,
        address: v.address,
        msme: v.msme,
        notes: v.notes,
      },
    });
  }

  console.log("Seed done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
