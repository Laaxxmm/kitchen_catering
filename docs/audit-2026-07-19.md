# Greenpath (kitchen_catering) — Full Codebase Audit
**Date:** 2026-07-19 · **Method:** 4 parallel specialist audits (security · database/data-integrity · business-flow/state-machine · UX/error-handling), every finding verified against the code before inclusion; speculative findings dropped. Schema-vs-migrations checked with `prisma migrate diff` on a throwaway DB.
**Totals after dedupe: 3 CRITICAL · 10 HIGH · 26 MEDIUM · 15 LOW = 54 findings.**
**This file is the work order for the fix pass. Recommended sequence: P0 → P1 → P2 → P3. Nothing here has been fixed yet.**

House rules for the fixer (non-negotiable, from the codebase's own conventions):
- Mutations return `{ ok:true, … } | { ok:false, error }` via `actionFailure`; never throw expected failures (prod masks them).
- Stock/money read-modify-write requires a `FOR UPDATE` row lock (`lockIngredientRow` / `lockBanquetItemRows` / `lockFloatRow` pattern) or a status-guarded `updateMany` with count check.
- Notifications via `deferAfterResponse` after the transaction commits.
- Never weaken a guard to make a path work — fix the flow.
- The system is LIVE in production: every fix must be additive/surgical, `npx tsc --noEmit` + `npm run build` green before every commit, data migrations idempotent and tested locally first.

---

## P0 — CRITICAL (broken business outcomes, fix first)

### C1. `OrderStatus.COMPLETED` is unreachable — no code ever sets it
- **Where:** whole repo (verified by grep); writers advance only to PAID: `src/server/actions/customer-invoices.ts:241,787,989,1066,1646`, `src/server/actions/payments.ts:136`. UI treats PAID as read-only done (`src/app/(dashboard)/orders/[id]/page.tsx:625-631`); `STAGE_FLOW` in `src/lib/order-status.ts` ends at PAID.
- **Impact:** every order in history is permanently non-terminal — the umbrella cause of the reported "orders to be closed 0016 and many. Error in closing." Side effect: `cancelOrder` (`orders.ts:1189`) excludes only CANCELLED/COMPLETED, so fully-PAID orders remain cancellable forever.
- **Fix:** auto-flip PAID→COMPLETED where the invoice settles (`markCustomerInvoicePaidInner`, `recordCustomerInvoicePayment` full-settlement branch, paid-at-door branches), or an explicit manager "Close order" from PAID. Also then exclude PAID from cancellable, or require payment reversal first.

### C2. Cancelling an order's invoice strands the order at INVOICED forever (the concrete "0016" trap)
- **Where:** `cancelCustomerInvoice` `src/server/actions/customer-invoices.ts:1221-1245`.
- **Impact:** invoice → CANCELLED but order stays INVOICED; re-invoicing requires DELIVERED (`:110`; button renders only at DELIVERED `orders/[id]/page.tsx:234`). The duplicate-invoice error (`:125`) even tells users "cancel it first to re-invoice" — a path that doesn't exist. Additional holes in the same action: **no status guard at all** — cancels PAID invoices (payments stay live; PAID order points at a cancelled invoice) and bypasses the IRN cancel flow (e-invoice GENERATED should demand IRN-cancel first, cf. `cancelCustomerInvoiceEInvoice` 24h rule).
- **Fix:** in the cancel tx: if kind ORDER and order is INVOICED → guarded revert order to DELIVERED; refuse cancelling PAID invoices (require payment reversal); refuse when eInvoiceStatus = GENERATED until IRN cancelled.

### C3. Cancelled orders can be resurrected to live statuses (two independent paths)
- **Path A — delivery OTP:** `confirmDeliveryOTPInner` `src/server/actions/deliveries.ts:704,743-744,772-783` rejects only DELIVERED/FAILED; a delivery cancelled by `cancelOrderInner` passes, flips itself to DELIVERED and unconditionally sets the ORDER to DELIVERED → a cancelled order becomes billable from a stale driver screen. `failDelivery` (`:827-829`) has the same hole (→FAILED, less damaging).
- **Path B — kitchen card:** `markProductionItemReady` `src/server/actions/production-jobs.ts:194-217` guard is `status:{not:READY}` which matches CANCELLED items; cascade then runs unguarded `productionJob.update(READY)` + `order.update(READY)`. `cancelOrder` (`orders.ts:1237-1250`) cancels the job but **not the job items**, so a stale tap on the last item resurrects the order to READY → re-enters dispatch/billing.
- **Fix:** A: add CANCELLED to both exclusion lists + guard the order write with `status: OUT_FOR_DELIVERY`. B: item guard `status:{in:[QUEUED,IN_PROGRESS]}`, order cascade guarded `updateMany({where:{status:{in:[IN_PREP,READY_FOR_PRODUCTION]}}})`, and `cancelOrder` also cancels open `productionJobItem` rows.

---

## P1 — HIGH

### H1. GRN posts ingredient stock from an unlocked snapshot (lost updates, corrupted average cost)
- **Where:** `createGRN` `src/server/actions/procurement.ts:743-847` — PO loaded with `include:{lines:{include:{ingredient:true}}}` at tx start; `newMovingAverage` computes absolute `onHandQty`/`avgUnitCost` from that stale read, written back with **no `lockIngredientRow`**. (Banquet branch of the same function locks correctly — the ingredient branch is the outlier; every other ingredient movement locks.)
- **Fix:** per accepted ingredient line: `lockIngredientRow(tx,id)` → re-read qty/cost → compute → write (the `inventory.ts` pattern).

### H2. Payment recording has no row lock on invoice/bill (double-record slips the guard)
- **Where:** `recordCustomerInvoicePayment` `src/server/actions/payments.ts:58-151`, `recordVendorBillPayment` `:275-322`, plus both reverse functions. Concurrent recordings both read prior payments excluding each other, both pass the over-recording guard; last recompute wins with wrong `amountPaid`. `recordVendorBillPayment` has **no over-payment guard at all**.
- **Fix:** `SELECT 1 … FOR UPDATE` on the CustomerInvoice/VendorBill row before reading payments (the `lockFloatRow` discipline); add the missing vendor-bill over-payment guard.

### H3. "Mark paid" double-click creates two full-balance payment rows
- **Where:** `markVendorBillPaid` `procurement.ts:1414-1457`, `markCustomerInvoicePaid` `customer-invoices.ts:932-1001` — read status+balance then unconditionally insert payment + set PAID; two tabs both pass.
- **Fix:** row-lock (H2's helper) or flip status via guarded `updateMany` BEFORE creating the payment; abort on count 0.

### H4. Failed delivery strands the order at OUT_FOR_DELIVERY — no redelivery path
- **Where:** `failDelivery` `deliveries.ts:813-852` never touches the order; both re-schedule paths (`scheduleDelivery:543`, `claimDelivery:481`) and `listReadyForDispatch:344` require READY.
- **Fix:** in `failDelivery`, guarded revert order OUT_FOR_DELIVERY→READY so it reappears in dispatch.

### H5. Consolidated in-house invoices (`orderId: null`) orphan their orders at INVOICED
- **Where:** `createConsolidatedInHouseInvoiceInner` `customer-invoices.ts:1596,1644-1647` — advances member orders to INVOICED but the invoice stores `orderId:null`; every payment path advances only `invoice.orderId` (null) → room-service/à-la-carte/management orders billed via folio and not paid at door can never reach PAID; cancel has no back-link and orders can't be re-billed.
- **Fix:** persist member order ids (relation table preferred) and advance/revert them on pay/cancel.

### H6. Vendor bill in DISCREPANCY from a keying error is a dead end
- **Where:** `updateVendorBill` `procurement.ts:1173-1177` allows only DRAFT/PENDING_MATCH; DISCREPANCY can only be force-approved wrong or left forever; no VOID status, no delete. Error advice "record a fresh bill" creates an undeletable duplicate payable inflating AP.
- **Fix:** allow edit from DISCREPANCY (resets match state), or add VOID status+action. Related: M10 (match has no status guard at all).

### H7. `cancelOrder` cascade misses banquet requisitions and order-linked POs
- **Where:** `orders.ts:1198-1260` closes chef requisitions/production jobs/deliveries only. Open BanquetRequisitions stay in the store queue (`banquet.ts:1249-1263` has no order-status filter) → cutlery picked for a cancelled event; `VendorPO.orderId` POs ride on.
- **Fix:** extend cascade — cancel open banquet requisitions (store-close semantics), notify about live linked POs.

### H8. ~14 mutations still throw instead of returning errors → masked in production
- **Where:** `banquet.ts:71,167` (`upsertBanquetItem`, `deleteBanquetItem`), `housekeeping.ts` (6 fns), `maintenance.ts` (4 fns), `admin-reset.ts` (2 fns). Their 7 client callers (banquet/items ItemsTable, housekeeping items/rooms/staff, maintenance items/staff, admin CleanSlate) try/catch + toast `err.message` — works in dev, prod shows "An unexpected response was received from the server." The crafted refusal at `banquet.ts:176` is never seen.
- **Fix:** wrap each body `try{…}catch(err){return actionFailure(err)}` returning ActionResult; check `res.ok` in the 7 components (pattern exists 3 files over).

### H9. Vendor select silently defaults to the first vendor on money documents
- **Where:** `VendorBillForm.tsx:52,115`, `VendorPOForm.tsx:61,194` — `useState(initialVendorId || vendors[0]?.id || "")`, no placeholder option → bills/POs recorded against whichever vendor sorts first, no error ever fires.
- **Fix:** initial `""` + disabled `— pick vendor —` option; existing "Pick a vendor" toast then protects.

### H10. Store keeper can record supplier bills but has no menu entry to reach them
- **Where:** `src/lib/role-nav.ts:36-40` — STORE_KEEPER set lacks `"supplierbills"` though middleware (`middleware.ts:96`) and the PO page admit them.
- **Fix:** add `"supplierbills"` to the STORE_KEEPER nav set.

---

## P2 — MEDIUM

**Security (6):**
- **M1** `notifications.ts:29` — `createNotification` is an ungated `"use server"` export: any authed user can mint a notification for any userId with arbitrary title/body/link (phishing at ADMIN). Fix: de-export / move out of the actions module.
- **M2** `notifications.ts:62` — `notifyRoles` same vector, fans to whole roles. Same fix.
- **M3** `petty-cash.ts:80,92,122` — float reads + voucher creation gated `ANY_WRITE` (incl. STORE_KEEPER/KITCHEN_HEAD) while `/petty-cash` routes are finance-only → non-finance roles can read balances / create vouchers by direct action invocation. Fix: tighten to the finance set (or ship the intended field-staff UI deliberately).
- **M4** `customer-invoices.ts:280` — `createProformaInvoiceForOrder` deliberately skips `requireRole` and is an exported `"use server"` action → any authed user can mint a proforma + trigger customer email. Fix: move to a non-`"use server"` core module or gate it.
- **M5** `customer-invoices.ts:811` — `emailTaxInvoice` ungated → anyone can (re)send invoice emails and stamp `emailedAt`. Fix: `requireRole(WRITE_ROLES)`.
- **M6** `api/invoices/[id]/pdf/route.ts:15` + `getCustomerInvoice` (`customer-invoices.ts:1667`) — session-only → any staff can download any customer invoice PDF (amounts, GSTIN, address). Fix: role-check in `getCustomerInvoice` or the route.

**Database/races (7):**
- **M7** `procurement.ts:780-787,949-952` — GRN over-receive check reads `receivedQty` from unlocked snapshot; two concurrent GRNs → received > ordered. Fix: FOR UPDATE the PO lines (or header) before validating.
- **M8** `customer-invoices.ts:117-126,239-242` — one-invoice-per-order is check-then-create with no unique index; DELIVERED→INVOICED update unguarded → two ISSUED invoices on double-click. Fix: guarded `updateMany({where:{status:DELIVERED}})` first + partial unique index `(orderId) WHERE kind='ORDER' AND status<>'CANCELLED'`.
- **M9** `customer-invoices.ts:1644-1647` — consolidated folio's final `order.updateMany` lacks `status: DELIVERED` in WHERE → overlapping submissions double-bill. Fix: add status to WHERE, throw if count ≠ orders.length.
- **M10** `procurement.ts:1258-1348` — `matchVendorBill` has no status validation: re-running the match against APPROVED or PAID demotes a settled record to MATCHED/DISCREPANCY. Fix: allow only DRAFT/PENDING_MATCH/MATCHED/DISCREPANCY via guarded `updateMany`.
- **M11** `deliveries.ts:486-491,537-575` — `claimDelivery` check-then-create race; `scheduleDelivery` performs **no existing-delivery check at all** → duplicate deliveries. Fix: existing-active check in schedule + FOR UPDATE on the order (or partial unique index on `Delivery(orderId) WHERE status NOT IN ('FAILED','CANCELLED')`).
- **M12** `banquet.ts:1012-1073` — `markBanquetLineAwaitingProcurement` reads the line unlocked / updates unguarded: two "Raise PO" clicks → two draft POs for one shortfall, first PO stranded. Fix: FOR UPDATE + status-guarded update (mirror `issueBanquetRequisitionLine`).
- **M13** Schema/migrations FK drift (verified via `prisma migrate diff`): `ChefRequisition_orderId_fkey` and `IngredientIssue_orderId_fkey` are `ON DELETE RESTRICT` in the DB but schema now implies SET NULL (relations went optional in `20260701140000/150000` without FK recreation). Fix: one migration dropping/re-adding both FKs with SET NULL.

**Flow (5):**
- **M14** COUNTER_SALE missing from two hardcoded channel lists shadowing `EVENT_DELIVERY_CHANNELS`: `listEventPrepQueue` `deliveries.ts:203` and `listBanquetEvents` `banquet.ts:739` hardcode `[BANQUET,BUFFET,ODC,PACKET]` → counter-sale events never appear in the Event-prep tab and cutlery issues can't link to them (forces "No cutlery required" workaround). Fix: export the shared set from `order-channels.ts`, reuse in both queries. *(Found independently by two auditors.)*
- **M15** Notification links landing recipients on /forbidden: `handToDelivery` `deliveries.ts:177-184` + `scheduleHandoverNotify` `production-jobs.ts:317-327` send Role.DELIVERY to `/deliveries/new` (page gates ADMIN/MANAGER); `markCustomerInvoicePaid` fanout (`customer-invoices.ts:1010-1014`) sends SALES to `/invoices/{id}` (middleware denies); `allocateOrderFeedback` (`orders.ts:1357-1366`) can assign HOUSEKEEPING/MAINTENANCE users who can't open `/orders/{id}`. Fix: driver links → their dashboard; add SALES to invoices read rule or drop from fanout; feedback links → `/tasks/{taskId}`.
- **M16** Chef requisition AWAITING_PROCUREMENT loop closes only by human memory — `ChefRequisitionLine` has no `vendorPOLineId` (unlike the banquet twin); ingredient GRNs notify nobody about waiting chef lines → orders sit at ISSUING until the store remembers. Fix: mirror the banquet pattern (link column + GRN flip/notify).
- **M17** `cancelBanquetRequisition` (`banquet.ts:1189-1204`) cancels AWAITING lines but leaves the spawned VendorPO riding to GRN → goods bought for a dead request. Fix: auto-cancel DRAFT/PENDING_APPROVAL linked POs (or flag/notify).
- **M18** PO ≥ ₹5k half-approved: single admin notification with a permanent dedupeKey (`procurement.ts:516-522`), no re-nudge, no approver-pool check (empty ADMIN pool = silent no-op) → PO sits PENDING_APPROVAL indefinitely. Fix: daily reminder scan (mirror the vendor-reminders cron), keyed per-day.

**Data-correctness (2):**
- **M19** Rounding-convention split vs `gst.ts summarise()` (per-line-round-then-sum) — hand-rolled opposite convention at `procurement.ts:1080-1104` (`computeVendorBillLines` — bill header can differ from its own lines; PO vs bill conventions differ, eroding the ±₹1 match tolerance), `procurement.ts:181-199`, `orders.ts:221-234`, `customer-invoices.ts:548-567,637-658`. Fix: route all line math through `gst.ts`.
- **M20** `mergeIngredient` (`inventory.ts:485-558`) ignores unit compatibility — merging a "pkt" item into a "kg" one numerically corrupts stock/cost and every open line. Fix: refuse when `unitsMatch(source.unit,target.unit)` is false.

**UX (6):**
- **M21** ~20 ActionError texts interpolate raw status enums ("Cannot approve a bill in status PENDING_MATCH"): `procurement.ts:171,1357`, `customer-invoices.ts:111,1049`, `chef-requisitions.ts:75,424`, `deliveries.ts:544,592,644,705,821`, `quotes.ts:159,325,371,426,676`, `orders.ts:474,1195`. Fix: humanize (`.toLowerCase()` or STATUS_LABEL map).
- **M22** `action-result.ts:55-59` — Zod failures toast raw paths ("lines.0.requestedQty: Required"). Fix: drop/humanize the prefix.
- **M23** `VendorPOForm.tsx:289` — PO line picker is a raw `<select>` over 1000+ items, no type-to-search; `ui/combobox` already exists and is used in OrderForm. Fix: swap to Combobox.
- **M24** Four tables missing `overflow-x` wrapper (break at 375px): `banquet/stock-count/StockCountForm.tsx:96`, `grns/new/GRNForm.tsx:77`, `vendor-bills/new/VendorBillForm.tsx:148`, `inventory/audit/AuditForm.tsx:66`. Fix: wrap in `overflow-x-auto`.
- **M25** `MarkPaidModal.tsx:113-118` — payment-method select shows raw enums ("BANK_TRANSFER", "CREDIT_NOTE" as pickable method invites miscategorized receipts). Fix: label map.
- **M26** `purchase-orders/[id]/page.tsx:259` — bill list prints `{billNo} · {status}` raw ("PENDING_MATCH"). Fix: StatusBadge.

---

## P3 — LOW

- **L1** `middleware.ts:79` admits ACCOUNTS to `/inventory/receipts` but `recordIngredientReceipt` (`inventory.ts:261`) refuses them — broken button, no privilege hole. Align one side.
- **L2** `auth.ts:76,89` — plaintext emails logged on every login attempt (minor PII-in-logs). Redact in prod.
- **L3** `vendors.ts:218-247`, `reminders.ts:111` — `Number()` float accumulation on money (display-only). Use toDecimal.
- **L4** `procurement.ts:951` — `receivedQty:{increment: accepted.toNumber()}` routes a Decimal through a JS float. Pass `new Prisma.Decimal(accepted.toString())`.
- **L5** `customer-invoices.ts:1083` — `void generateIRNForInvoice(id)` floating promise; the only post-commit side effect not using `deferAfterResponse`.
- **L6** `banquet.ts:167-194` — `deleteBanquetItem` history guard is outside the tx (TOCTOU) and misses `BanquetRequisitionLine.itemId` (RESTRICT → raw P2003 crash) and `VendorPOLine.banquetItemId` (SET NULL → live PO line silently unlinks); also throws bare Error (see H8). Extend the guard, move into tx, use ActionError.
- **L7** `schema.prisma:1960,2000` — `RequisitionNumberSequence` / `SalaryRunNumberSequence` are dead models. Delete when convenient.
- **L8** `deliveries.ts:159-174` — `handToDelivery` stamp + audit are two separate db calls, not one tx.
- **L9** Orders whose event date passes in early states accumulate; approvals don't re-check dates. Add a hygiene scan or approval-time warning.
- **L10** `VendorBillStatus.PENDING_MATCH` and `OVERDUE` are never SET by any code — AP donut's Overdue segment is permanently zero; dead filter options. Wire an overdue flipper into the reminders cron or drop from UI.
- **L11** `users.ts:95` — `deactivateUser` leaves open tasks/deliveries assigned to the dead account (escapable via managers, but nothing surfaces the orphans). Surface/reassign at deactivation.
- **L12** `deliveries.ts:673-688` — stale docstring on `confirmDeliveryOTP` describes auto-invoicing that was deliberately removed; confusion sits exactly where C2 lives. Update comment.
- **L13** `action-result.ts:63-66` — P2002 message leaks DB column names. Map to labels.
- **L14** ~40 qty inputs lack `min="0"` (server Zod protects; UX round-trip only).
- **L15** Notes fields lack client `maxLength` mirrors of the server caps (Zod protects; UX only).

---

## Verified clean (checked, no finding)
- **No SQL injection** (all raw SQL parameterized; `Prisma.raw` table names are fixed literals), **no XSS** (the only raw-HTML injection point is the static theme script in layout.tsx with no user data; emails escape all fields via escapeHtml), **no path traversal** (storage resolver normalizes + re-checks root; magic-byte upload sniffing), **no hardcoded secrets** (env-validated at boot; mobile JWT derives from AUTH_SECRET), **no auth bypass** (bcrypt cost 12, rate-limited logins, hashed+rotated mobile refresh tokens).
- Export/cron/mobile API routes all gated; document downloads role-mapped per entity.
- All document numbering atomic (FY-scoped upsert sequences); data migrations idempotent; enum label maps compile-proven exhaustive.
- Banquet requisition ↔ PO loop closes both directions incl. PO-cancel un-strand; chef issue path race-guarded; task lifecycle closed; payment reversal demotes PAID→INVOICED correctly; zero-value orders don't stick; recalled-PO tier re-evaluation correct; petty cash locking correct.
- Notification hygiene (doc numbers, deep links, sane dedupe) good app-wide except the /forbidden links in M15.

## Suggested fix phases for the follow-up model
1. **Phase P0 (C1–C3):** order lifecycle closure + resurrection guards. Small diffs, huge operational value. Test each on the local smoke DB.
2. **Phase P1a (H1–H3):** the three financial race conditions — one locking pattern applied three places.
3. **Phase P1b (H4–H7):** flow dead-ends (failed delivery, consolidated invoices, bill discrepancy, cancel cascade).
4. **Phase P1c (H8–H10):** masked errors + vendor default + nav entry (pure UX, zero risk).
5. **Phase P2:** security de-exports/gates first (M1–M6), then races (M7–M13), flow (M14–M18), correctness (M19–M20), UX polish (M21–M26).
6. **Phase P3:** batch the lows opportunistically alongside neighboring fixes.
