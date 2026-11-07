export function materialDateKey(timestamp: number | null) {
  if (timestamp === null || !Number.isFinite(timestamp)) return 'unknown';
  const date = new Date(timestamp * 1000);
  if (!Number.isFinite(date.getTime())) return 'unknown';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Construct each midnight locally so DST days can have 23 or 25 hours. */
export function materialDateRange(month: string, day: string) {
  if (!month && !day) return {};
  const [year, monthNumber, date = 1] = (day || month).split('-').map(Number);
  const start = new Date(year, monthNumber - 1, date);
  const end = day ? new Date(year, monthNumber - 1, date + 1) : new Date(year, monthNumber, 1);
  return { created_after: start.getTime() / 1000, created_before: end.getTime() / 1000 };
}

export function materialMatchesDate(timestamp: number | null, month: string, day: string) {
  const key = materialDateKey(timestamp);
  return day ? key === day : month ? key.startsWith(month + '-') : true;
}
