# Greenpath — security & structure status

**As of 5 September 2026.** This supersedes the audit of 19 July 2026, which is
kept as [docs/audit-2026-07-19.md](docs/audit-2026-07-19.md) for the record.
That document listed 54 findings and said none were fixed; the three criticals
and most of the highs have since been fixed in the ordinary course of work, and
several things it did not know about were found and fixed in the
end-to-end test campaign of 7 August. Rather than re-adjudicate 54 items, this
file states what is verified now.

## Verified in place

Each of these is asserted by a test that fails without it.

| Control | Where it is proven |
|---|---|
| Every mutating action admits exactly the desks it should; a new action that is not registered fails the build | `tests/e2e/access/matrix.test.ts` |
| Inline page actions gate themselves or delegate to a gated action | `tests/unit/inline-actions-gated.test.ts` |
| Deactivating a user, changing their role or password ends their session on the next call — not at token expiry | `tests/e2e/access/session-lifecycle.test.ts` |
| A proforma can never be paid; nothing is payable before accounts approve; approval does not require the vendor's invoice | `tests/e2e/03-supplier-bill.test.ts`, `tests/unit/vendor-bill-gates.test.ts` |
| Stock figures are set by hand by admin/manager only; the store receives through the GRN | `tests/e2e/stock/lockdown.test.ts`, `tests/unit/route-access.test.ts` |
| Over-delivery and off-PO items amend the PO so the 3-way match still holds; every amendment is audited | `tests/e2e/procurement/receive-what-came.test.ts` |
| Cancelling an order refuses while a live invoice stands | `tests/e2e/hygiene/01-cancel-and-read.test.ts` |
| Uploads are sniffed by magic bytes, stored under random names, served only through a per-entity role map | `tests/e2e/hygiene/02-attachments-and-otp.test.ts` |
| The bootstrap seed cannot re-plant its sample catalogue into a live database | `tests/e2e/catalogue/seed-cannot-repopulate.test.ts` |
| Stock ledgers agree with the shelf, opening stock included, for both stores | `tests/e2e/stock/reports.test.ts`, `tests/e2e/fnb-ledger/` |

Also in place, not test-backed: security response headers (HSTS, frame, nosniff,
referrer, permissions), header-only cron auth, login rate limiting per email
(mobile: per email + device), 192-bit random share tokens for the public quote
link, `.env` never committed, non-root container, migrations on boot.

## Known and deliberately open

| Item | Why it is still open |
|---|---|
| No Content-Security-Policy | The theme snippet in `app/layout.tsx` and Next's inline scripts need nonces first. Separate piece of work. |
| Petty-cash top-ups over ₹10,000 are self-approved by accounts | Client policy call; the code now says so plainly instead of claiming an approval that does not exist. |
| Physical stock counts write the figure with no movement document | Needs an adjustment table on both stores; cannot be wrong until someone runs a count. |
| Customer contact details visible to every operational role | Deliberate — drivers need the address. Revisit the moment a role is added that should not see them. |
| In-memory rate limiter | Correct for one replica (`railway.json`); stops working silently above that. |
| `uuid <11.1.1` (moderate) in the tree | Transitive; needs `npm audit fix --force`. |
| No database backups on Railway | Operational, not code. **The largest open risk** while an erase-everything button exists. |

## Housekeeping the operator owns

- Rotate the GitHub token pasted into a chat session, and every seeded password
  (`changeme123` is public in this repository).
- `SEED_DB` must stay unset in production. The code guards against it now;
  the flag still has no business being on.
- Configure Railway Postgres backups.
