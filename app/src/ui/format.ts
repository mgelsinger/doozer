// Small pure formatters shared by the Card, the Radial and the focus chip.

/** 25:00, 04:59, 00:00. Rounds up, so a running clock never shows 00:00 before it is over. */
export function formatClock(remainingMs: number): string {
  const total = Number.isFinite(remainingMs) ? Math.max(0, Math.ceil(remainingMs / 1000)) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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
