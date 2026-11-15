const CYCLE_DAYS = 28;

// "2026-10-29" -> "2026-10-29 to 2026-11-26" (a NASR cycle is valid for 28 days).
export function formatNasrEffective(effectiveDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(effectiveDate || ''));
  if (!match) return String(effectiveDate || 'UNKNOWN');

  const [, year, month, day] = match;
  const end = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + CYCLE_DAYS));
  return `${effectiveDate} to ${end.toISOString().slice(0, 10)}`;
}

// Short form for the header: "2026-10-29" -> "2026-10-29 to 11-26" (the end year is kept only when the cycle crosses a year).
export function formatNasrEffectiveShort(effectiveDate) {
  const full = formatNasrEffective(effectiveDate);
  const match = /^(\d{4})-\d{2}-\d{2} to (\d{4})-(\d{2}-\d{2})$/.exec(full);
  if (!match) return full;
  const [, startYear, endYear, endMonthDay] = match;
  return `${effectiveDate} to ${startYear === endYear ? endMonthDay : `${endYear}-${endMonthDay}`}`;
}
