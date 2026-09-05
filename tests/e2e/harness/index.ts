/**
 * The e2e harness, public API. A scenario file needs nothing but this import
 * plus the server actions it is exercising.
 *
 * How it works: `requireRole`/`requireSession` (src/server/rbac.ts) read
 * `auth()` and nothing else, so the harness stubs that one function and swaps
 * the user behind it. Everything downstream — the guards, Prisma, the Decimal
 * maths, the transactions — is the real thing running against the kc-e2e
 * Postgres container. Nothing is reimplemented here: if a test wants to know
 * an outcome it reads it back out of the database (see `read`).
 *
 * Run it:  npm run test:e2e
 *
 * ── Sessions ──────────────────────────────────────────────────────────────
 *   asAdmin() asManager() asChef() asStore() asDelivery() asAccounts()
 *        Become that desk. Each returns the real seeded User row (real id).
 *   asNobody()                 Signed out — guards must throw.
 *   desk("chef")               That desk's User row without switching to it.
 *   actingAs("store", fn)      One call as a desk, then put the session back.
 *
 * ── Database ──────────────────────────────────────────────────────────────
 *   ensureSeeded()             Reset → import → master data. Call in beforeAll;
 *                              costs ~5s and runs once per test file.
 *   resetAndReseed()           The same routine, unconditionally.
 *   freshSlate()               Clear the transactional tables only (no
 *                              re-import) — for a clean slate mid-file.
 *   importCatalogue()          Run the real import script again, as go-live
 *                              runs it — for asserting it is idempotent.
 *   seeded()                   { customerId, vendorId, dishIds, ingredients }
 *   INGREDIENT_CODES           The two catalogue codes the fixtures use.
 *
 * ── Assertions ────────────────────────────────────────────────────────────
 *   mustOk(result, "what")     Unwrap {ok:true}, or fail with the server's
 *                              own error message.
 *   expectRefused(fn)          Assert {ok:false} (or a thrown Authorization/
 *                              AuthenticationError); returns the message so
 *                              you can assert WHY.
 *   expectDecimal(v, "12.5")   Compare a Prisma.Decimal by value.
 *   read.*                     Typed reads back out of the database:
 *                              orderStatus, order, requisition, onHand,
 *                              invoice, taxInvoiceForOrder, purchaseOrder,
 *                              vendorBill, delivery, productionJob,
 *                              auditActions.
 *
 * ── Openings (real actions, composed) ─────────────────────────────────────
 *   placeCateringOrder(opts)   Manager takes + submits a banquet order.
 *   chefAccepts(orderId)       Chef accepts → CHEF_REQUISITION_PENDING.
 *   driveOrderToDelivered(id)  Skip the requisition, cook, dispatch, confirm.
 *   stockUp(ingredientId, qty) Put stock on the shelf via a real receipt.
 *   istInput(date)/daysFromNow(n)
 *
 * ── Deferred work ─────────────────────────────────────────────────────────
 *   flushDeferred()            Await the notification fan-out / auto-proforma
 *                              / invoice email that `after()` would have run
 *                              post-response. Also runs after every test.
 */

export {
  asAdmin,
  asManager,
  asChef,
  asStore,
  asDelivery,
  asAccounts,
  asNobody,
  asUser,
  actingAs,
  desk,
  DESK_EMAILS,
  DESK_ROLES,
  type DeskName,
  type HarnessUser,
} from "./session";

export {
  ensureSeeded,
  resetAndReseed,
  freshSlate,
  importCatalogue,
  seeded,
  INGREDIENT_CODES,
  type Fixtures,
} from "./seed";

export { mustOk, expectRefused, expectDecimal, decimalEquals } from "./assert";

export {
  placeCateringOrder,
  chefAccepts,
  driveOrderToDelivered,
  stockUp,
  istInput,
  daysFromNow,
  type PlacedOrder,
} from "./flows";

export { flushDeferred } from "./deferred";

export * as read from "./read";
