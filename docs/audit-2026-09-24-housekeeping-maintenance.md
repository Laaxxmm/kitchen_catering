# Housekeeping & Maintenance — go-live audit, 24 September 2026

Five read-only audits ran in parallel (housekeeping stock ledger, maintenance
stock and activities, information capture, informing and management
visibility, access and test coverage). This is the consolidated record: what
was wrong, what this pass fixes, what is deliberately left for a next phase,
and what the team has to do to switch the modules on.

Status column: **fixed** = in the code as of this pass; **later** = agreed
next phase; **policy** = needs the owner's decision.

## 1. Stock arithmetic

| # | Sev | Module | Finding | Status |
|---|-----|--------|---------|--------|
| A1/B1 | BLOCKER | HK, Maint, F&B | Stock check ran per line against one snapshot: two lines for the same item overdrew, stock went negative. | fixed — quantities summed per item under the row lock; DB CHECK constraints refuse negative stock in all three stores |
| A2/B4 | BLOCKER | HK, Maint | Returns, linen write-offs and hand adjustments left only a sha256 hash in the audit log: no quantity, no reason readable, on-hand could not be rebuilt. | fixed — `HousekeepingAdjustment` / `MaintenanceAdjustment` tables (kind ADJUSTED / RETURNED / LOST / RESTORED, before, after, delta, reason, note, who); HK returns page lists them |
| B2 | BLOCKER | Maint | An activity saved as CANCELLED still took its spares off the shelf, permanently. | fixed — create accepts PENDING / IN_PROGRESS / COMPLETED only |
| B3 | HIGH | Maint | No way to change an activity after creation: PENDING never closed, the dashboard "Open" count only rose. | fixed — `updateMaintenanceActivityStatus`; cancel puts spares back and records it |
| A3/B6/C31 | HIGH | all | Fifteen forms defaulted the date box to the UTC clock, read by the server as IST: every record saved with the default time was 5h30 early. | fixed — one IST helper, all forms |
| A4/C3 | HIGH | HK | "Consumed" counted reusable linen issued to rooms; returns never subtracted. | fixed — consumption = consumables only; reusables shown as issued / returned / lost |
| A7/B5/C32 | HIGH | HK, Maint | A "To" date excluded its own day (from = to = today returned nothing). | fixed |
| A9/B11 | MEDIUM | HK, Maint | Unit could be changed on an item with stock or history (100 metres became 100 rolls); reusable flag could be cleared with linen still out. | fixed — refused |
| A10/B9 | MEDIUM | HK, Maint | Deactivate actions threw instead of returning a result (generic error in production); items with stock or linen out could be hidden. | fixed |
| A11/B7/B8 | MEDIUM | HK, Maint | Receipts and activities did not check the item / staff / room existed and was active. | fixed |
| A8/B10 | MEDIUM | HK, Maint | A line with only one of item / quantity filled was silently dropped. | fixed — refused |
| A15/B12/B13 | MEDIUM | HK, Maint | Case-sensitive duplicate names; untrimmed input; negative minimums and costs accepted. | fixed |
| A12/B19 | MEDIUM | HK, Maint | No document numbers and no idempotency on receipts / issues / activities (double submit blocked in the browser only). | later |
| A6/B15/D20 | MEDIUM | HK, Maint | Receipt cost per unit captured but never summed: no stock valuation, no spend. | later — needs a costing decision (last cost vs weighted average) |
| A14/B17/D5 | MEDIUM | HK, Maint | Department managers may hand-set their own stock (kitchen and F&B restrict this to admin/manager). | policy — kept, but every adjustment is now recorded and the manager is notified |
| E1 | HIGH | HK | Store keeper can move HK stock through a transfer; the HK manager could not see it. | fixed (notified) — the transfer roles themselves are a policy call |
| A20/C7 | LOW | HK, Maint | Lists cap at 200 / 300 rows with no pagination. | later |

## 2. Information captured

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| C1 | HIGH | Rooms carry no status (clean / dirty / occupied / out of order), no cleaning log, no last-cleaned-by. | later — room board + cleaning log is the next housekeeping phase |
| C2/B18 | HIGH | Issues and receipts cannot be voided or corrected. | later |
| C19 | HIGH | No complaint → job → close loop on maintenance: no reported time / by, priority, started / completed. | partly — completedAt / cancelledAt and the status action are in; reporter, priority and started-at are later |
| C5/A19 | MEDIUM | Returns had no record, no room / staff, no list. | fixed |
| C6/C24 | MEDIUM | Receipt vendor is free text; no invoice number / date / attachment. | later |
| C21 | MEDIUM | No cost on a maintenance job (labour hours, contractor cost). | later |
| C23 | MEDIUM | Every job needs a Room; the maintenance manager cannot create common-area locations. | later — the rooms list is now linked from their landing and readable, write buttons hidden; admin creates common-area rooms |
| C9/C25 | MEDIUM | Item notes wiped on every edit. | fixed |
| C4/C30 | LOW | Staff have no shift / section. | later |

## 3. Informing and management visibility

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| D9 | HIGH | Admin and manager home showed nothing about housekeeping or maintenance. | fixed — both panels on the admin / manager dashboard |
| D1 | HIGH | Nobody told when a maintenance job is completed or cancelled. | fixed — reporter and manager notified |
| D2 | HIGH | Housekeeping could not report a room defect to maintenance. | fixed — HK manager logs a PENDING job (no spares); maintenance manager notified |
| D3 | HIGH | Low stock notified nobody. | fixed — department manager + manager, once per item per day |
| D4 | HIGH | Linen written off as lost told nobody. | fixed — manager + admin |
| D6 | MEDIUM | Transfers touching the HK store told the HK manager nothing. | fixed |
| D10/D11 | MEDIUM | Attention banner, Stores badge and Stores strip counted kitchen only / ignored zero-stock items without a minimum. | fixed |
| D15/C16 | MEDIUM | Maintenance manager saw room buttons that refused them; no way to the rooms list from their landing. | fixed |
| D18 | MEDIUM | Audit log rows for these modules had no link to the record. | fixed |
| D21 | MEDIUM | Reports hub had no HK / maintenance tiles and no Excel export. | fixed |
| D8 | LOW | Task review does not notify the assignee. | later |

## 4. Access and tests

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| E3 | HIGH | On a fresh go-live the maintenance manager cannot log a job: activities need a room and they cannot create one. | policy — admin creates the rooms (see checklist); common-area locations are a later phase |
| E5/E6/E7 | MEDIUM | No housekeeping / maintenance test users; no test ran any HK or maintenance stock, report or role path. | fixed — two desks in the harness; ledger, lifecycle, access and report tests |
| E9 | MEDIUM | Two route tests only. | fixed |
| E10 | LOW | One read-role list for all three stores. | later |
| E12 | LOW | Feedback tasks could be assigned to users who cannot open the order. | fixed server-side (the assignee list still shows them; the save refuses) |

## 5. Go-live checklist (the team)

1. Admin → Users: confirm `housekeeping@` and `maintenance@` users exist with roles Housekeeping manager / Maintenance manager, and rotate the seed password.
2. Housekeeping → Rooms: create every room and common area (number, type, floor). Maintenance jobs need one.
3. Housekeeping → Staff and Maintenance → Staff: add the people.
4. Housekeeping → Items: check each item's unit, tick **reusable** on linen (towels, sheets) so it is tracked out-and-back, set a minimum stock on anything that must never run out. Maintenance → Items: same, minimums.
5. Opening stock: Housekeeping → Adjust stock / Maintenance → Adjust stock, reason "Opening balance" — one line per item. Every entry is recorded and the manager is notified.
6. Daily: receipts when goods arrive, issues to rooms as they go, returns when linen comes back, jobs logged as they are reported and closed when done.
7. Manager / admin: the home page now carries both panels; low stock, losses, completed and cancelled jobs arrive as notifications; Reports → Housekeeping / Maintenance for the period views and the Excel export.
