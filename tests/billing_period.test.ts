/**
 * Unit tests for canonical billing months (P0 bug 3): the same month written in different ways must
 * resolve to one month, and text that is not a month must not be guessed.
 * Pure functions only; no database, no network.
 */
import { canonicalBillingMonth, billingMonthLabel, chargeIsForMonth } from "../apps/erp/src/server/finance/billingPeriod";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${message}`);
  }
}

async function main() {
  console.log("BILLING PERIOD (canonical month) TESTS");

  const november = ["November 2026", "Nov 2026", "nov 2026", "NOV 2026", "  november   2026  ", "Nov. 2026", "Nov-2026", "Nov, 2026", "Novem 2026", "2026-11", "2026/11", "11/2026", "11-2026"];
  for (const text of november) {
    assert(canonicalBillingMonth(text) === "2026-11", `"${text}" → 2026-11 (got ${canonicalBillingMonth(text)})`);
  }
  assert(canonicalBillingMonth("Sept 2026") === "2026-09" && canonicalBillingMonth("Sep 2026") === "2026-09", "Sept and Sep → September");
  assert(canonicalBillingMonth("May 2027") === "2027-05" && canonicalBillingMonth("2027-1") === "2027-01", "Short month names and single-digit months");
  assert(canonicalBillingMonth("December 2026") !== canonicalBillingMonth("November 2026"), "Different months stay different");
  assert(canonicalBillingMonth("November 2027") === "2027-11", "Same month, different year stays different");

  for (const text of ["Verify Period 3", "Electricity Nov 2026", "No 2026", "Ju 2026", "2026-13", "13/2026", "November", "2026", "", "   "]) {
    assert(canonicalBillingMonth(text) === null, `"${text}" is not treated as a month`);
  }
  assert(canonicalBillingMonth(null) === null && canonicalBillingMonth(undefined) === null, "Missing text is not a month");

  assert(billingMonthLabel("2026-11") === "November 2026", `Rent-run label for 2026-11 is "November 2026" (got "${billingMonthLabel("2026-11")}")`);
  assert(canonicalBillingMonth(billingMonthLabel("2027-02")) === "2027-02", "The label round-trips to its month");

  assert(chargeIsForMonth({ billing_period: "Nov 2026", transaction_date: "2026-10-30" }, "2026-11"), "A charge named for November counts for November whatever its date");
  assert(!chargeIsForMonth({ billing_period: "October 2026", transaction_date: "2026-11-02" }, "2026-11"), "A charge named for October dated in November is October's");
  assert(chargeIsForMonth({ billing_period: "Verify Month", transaction_date: "2026-11-02" }, "2026-11"), "A charge with no month in its text counts for the month it is dated in");
  assert(!chargeIsForMonth({ billing_period: null, transaction_date: "2026-12-01" }, "2026-11"), "…and not for another month");

  console.log(`\nBILLING PERIOD RESULTS: ${passed} PASSED, ${failed} FAILED`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
