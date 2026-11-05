/**
 * Pins the process clock for a test file whose scenario is written for a particular calendar date.
 *
 * Some finance suites describe "a September payment reversed in October": the reversal service dates a
 * reversal with the current business date, so on any later date the reversal falls in another month
 * and the assertions describe a different scenario. Pinning makes such suites deterministic. Time still
 * runs forward from the pinned instant, so ordering and timestamps behave normally. Test-only.
 */
export function pinClock(isoInstant: string): void {
  const RealDate = Date;
  const start = RealDate.now();
  const base = new RealDate(isoInstant).getTime();
  if (Number.isNaN(base)) throw new Error(`pinClock: invalid instant ${isoInstant}`);
  class PinnedDate extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) super(base + (RealDate.now() - start));
      else super(...(args as [any]));
    }
    static now(): number {
      return base + (RealDate.now() - start);
    }
  }
  (globalThis as any).Date = PinnedDate;
}
