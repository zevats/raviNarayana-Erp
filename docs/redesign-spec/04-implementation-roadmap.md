# Ravinarayan ERP — Implementation Roadmap (Deliverable 10)

Order is by business impact and dependency. Nothing starts before the owner answers the decisions in `01-system-audit-and-gaps.md` §3.5 that gate it.

| Phase | Work | Backend change | Gate / decision |
|---|---|---|---|
| 0. Truth fixes | Dashboard business-date (not UTC); fix `totalDepositsHeld` and `outstandingRent` definitions; replace `http://localhost:3000` link in `ErpShell.tsx` with configured website URL; refresh stale `ISSUE_REGISTER` entries; show `TaskTimelineModal` in the stop panel | none or tiny | DECISION 8 |
| 1. Bring back hidden work | Mount Tiffin customers, catalogue, subscriptions, billing (existing components) under Customers; seed menu (idempotent seeder, owner approval) | none | DECISION 2 |
| 2. Kitchen | Mount Kitchen plan, stock, recipes if wanted | none | DECISION 1 |
| 3. Delivery management gaps | Reconciliation view, driver filter and summaries, exception ageing, driver performance report | read-only queries | — |
| 4. New modules | Activity log (read `audit_logs`); Settings (new `settings` table, replace env default driver and hard-coded cut-offs); extra notifications (subscription ending, handover waiting, closing missing) | one migration (`settings`), additive | DECISION: audit visibility to Manager |
| 5. Reports | Report catalogue with drill-down and CSV | queries only | — |
| 6. Property depth | Bed entities, room maintenance state, rent auto-charge | migrations, additive | DECISIONS 5, 6 |
| 7. Order edit/cancel | Rules for refund/ledger, then endpoint + UI | service + migration for status | DECISION 3 |
| 8. UI restructuring | Build the design system tokens, new shell and navigation, then re-skin module by module in this order: Login, Dashboard, Orders/Delivery, Residents, Money, rest. One module per release behind the existing routes. | none | Stitch screens approved |
| 9. Test and release | Browser tests per module (the project has a sandbox runner: `scripts/run-sandboxed-tests.ps1`), live-PG suites for new SQL, device test for the Android shell, no data-deleting deploy steps, builds only in the sandbox copy | — | — |

**Rules that carry over.** Never read or modify `data/erp.db`; never connect to Neon from the dev machine; migrations are additive and applied only by the production migrator; no step deletes existing data.

**Biggest risk.** Re-skinning while the Tiffin/Kitchen components are still unmounted would hide the largest functional gap behind a prettier shell. Phase 1 therefore precedes Phase 8.
