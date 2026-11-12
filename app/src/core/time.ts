// Calendar days, as the person at the keyboard counts them.

const MS_PER_DAY = 86_400_000;

/**
 * The local calendar day containing `ms`, as a whole number that goes up by exactly
 * one from each day to the next. Built from the local year/month/date rather than by
 * dividing milliseconds, so a 23- or 25-hour day at a daylight-saving change is still
 * one day and still next to its neighbours.
 */
export function localDay(ms: number): number {
  const d = new Date(ms);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY);
}
