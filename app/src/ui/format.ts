// Small pure formatters shared by the Card, the Radial and the focus chip.

/** 25:00, 04:59, 00:00. Rounds up, so a running clock never shows 00:00 before it is over. */
export function formatClock(remainingMs: number): string {
  const total = Number.isFinite(remainingMs) ? Math.max(0, Math.ceil(remainingMs / 1000)) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** The last stretch of a session is counted in seconds whoever is looking. */
export const QUIET_CLOCK_SECONDS = 60;

/**
 * The time left as it is shown when nobody is looking: whole minutes ("25 min"), rounded
 * up so that it never says less than is left, and seconds only for the last minute.
 *
 * A countdown that changes every second has the whole window drawn again every second,
 * for nobody (about half a percent of a processor core, in every view). In minutes it
 * changes once a minute. Each view shows the seconds again while someone is at it.
 */
export function quietClock(remainingMs: number): string {
  const total = Number.isFinite(remainingMs) ? Math.max(0, Math.ceil(remainingMs / 1000)) : 0;
  if (total <= QUIET_CLOCK_SECONDS) return formatClock(remainingMs);
  return `${Math.ceil(total / 60)} min`;
}

/** `remainingMs` as it is drawn when nobody is looking: to the minute above, and exactly for the last minute. */
export function quietRemaining(remainingMs: number): number {
  const total = Number.isFinite(remainingMs) ? Math.max(0, Math.ceil(remainingMs / 1000)) : 0;
  return total <= QUIET_CLOCK_SECONDS ? remainingMs : Math.ceil(total / 60) * 60_000;
}

/** "1 day" / "3 days". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Spoken form for screen readers: "12 minutes 5 seconds left". */
export function clockText(remainingMs: number): string {
  const total = Number.isFinite(remainingMs) ? Math.max(0, Math.ceil(remainingMs / 1000)) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${plural(seconds, 'second')} left`;
  return seconds === 0 ? `${plural(minutes, 'minute')} left` : `${plural(minutes, 'minute')} ${plural(seconds, 'second')} left`;
}
