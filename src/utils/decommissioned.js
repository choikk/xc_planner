// One-line note about instrument approaches the FAA discontinued in the current cycle.
export function formatDecommissionedNote(airport) {
  const items = Array.isArray(airport?.decommissioned)
    ? airport.decommissioned.filter((item) => item?.name)
    : [];
  if (items.length === 0) return '';

  const { effective_date: effectiveDate, cycle } = items[0];
  const when = [effectiveDate, cycle ? `cycle ${cycle}` : ''].filter(Boolean).join(', ');
  return `Discontinued${when ? ` (${when})` : ''}: ${items.map((item) => item.name).join(', ')}`;
}
