import { useEffect, useState } from 'react';

// A min/max distance pair that always keeps max >= min + RANGE_GAP (NM).
// - Editing min pushes max up when needed.
// - Editing max applies as soon as it is valid; while the typed value is still too small (for example "1" on the way to
//   "150") it only stays in the box, and when the field is left it lowers min to max - RANGE_GAP instead.
export const RANGE_GAP = 10;

function RangeInputs({ range, onChange, label, step = 10, limit = 5000 }) {
  const [minText, setMinText] = useState(String(range.min));
  const [maxText, setMaxText] = useState(String(range.max));

  useEffect(() => {
    setMinText(String(range.min));
    setMaxText(String(range.max));
  }, [range.min, range.max]);

  const changeMin = (event) => {
    setMinText(event.target.value);
    const value = Number(event.target.value);
    if (event.target.value === '' || !Number.isFinite(value)) return;
    const min = Math.max(0, value);
    onChange({ min, max: Math.max(range.max, min + RANGE_GAP) });
  };

  const changeMax = (event) => {
    setMaxText(event.target.value);
    const value = Number(event.target.value);
    if (event.target.value === '' || !Number.isFinite(value)) return;
    if (value >= range.min + RANGE_GAP) onChange({ min: range.min, max: value });
  };

  const commitMax = () => {
    const value = Number(maxText);
    if (maxText === '' || !Number.isFinite(value)) {
      setMaxText(String(range.max));
      return;
    }
    const max = Math.max(value, RANGE_GAP);
    onChange({ min: Math.max(0, Math.min(range.min, max - RANGE_GAP)), max });
    setMaxText(String(max));
  };

  const commitMin = () => {
    if (minText === '' || !Number.isFinite(Number(minText))) setMinText(String(range.min));
  };

  return (
    <div className="dual-inputs">
      <input
        type="number"
        aria-label={`${label} minimum NM`}
        value={minText}
        min="0"
        max={limit}
        step={step}
        onChange={changeMin}
        onBlur={commitMin}
      />
      <span>-</span>
      <input
        type="number"
        aria-label={`${label} maximum NM`}
        value={maxText}
        min={range.min + RANGE_GAP}
        max={limit}
        step={step}
        onChange={changeMax}
        onBlur={commitMax}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
      />
      <span className="range-unit">NM</span>
    </div>
  );
}

// How much longer the chosen route is than the straight line, e.g. "+0.2%".
function formatDetour(route) {
  if (!(route.direct > 0)) return '';
  const percent = ((route.total / route.direct) - 1) * 100;
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

function OneWayPlanner({ oneWay }) {
  const {
    legs,
    stops,
    route,
    homeCode,
    homeAirport,
    homeBaseCode,
    originIsHome,
    onResetOrigin,
    destCode,
    destAirport,
    slotOpen,
    destRange,
    destCandidateCount,
    onDestRangeChange,
    onClearDest,
    onFlip,
    problem,
    finishInfo,
    finished,
    onFinish,
    onAddStop,
    onLegChange,
    onClearFrom,
  } = oneWay;

  const segmentFor = (index) => route.segments[index] || null;

  const renderLeg = (index, toLabel) => {
    if (!legs[index]) return null;
    const segment = segmentFor(index);
    return (
      <div className="oneway-leg" key={`leg-${index}`}>
        <div className="oneway-leg-head">
          <strong>Leg {index + 1}</strong>
          <span className="oneway-leg-to">→ {toLabel}</span>
        </div>
        <RangeInputs range={legs[index]} label={`Leg ${index + 1}`} limit={2000} onChange={(range) => onLegChange(index, range)} />
        {segment && (
          <div className={`oneway-leg-result ${segment.ok ? 'ok' : 'bad'}`}>
            {segment.from} → {segment.to}: {segment.distance.toFixed(1)} NM{segment.mc ? ` · MC ${segment.mc}°` : ''}
            {segment.ok ? ' ✓' : ` (limit ${segment.min}–${segment.max} NM)`}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="distance-card oneway-origin">
        <h3>Origin</h3>
        {homeAirport ? (
          <div className="oneway-dest-card">
            <strong>{homeCode}</strong> – {homeAirport.airport_name}
            <div>
              {homeAirport.city}, {homeAirport.state === 'unknown' ? 'N/A' : homeAirport.state}
            </div>
            <div>
              Elevation {homeAirport.elevation} ft · Class {homeAirport.airspace} · Fuel {homeAirport.fuel}
            </div>
            {originIsHome ? (
              <div className="oneway-hint oneway-hint-tight">
                This is your home base (change it in the Home tab). Flip swaps origin and destination for this trip only.
              </div>
            ) : (
              <div className="oneway-hint oneway-hint-tight">
                Home base: {homeBaseCode}. Flip changed the origin for this trip only.{' '}
                <button type="button" className="oneway-link" onClick={onResetOrigin}>
                  Use home base as origin
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="empty-text">Select a home base in the Home tab.</p>
        )}
      </div>

      {destAirport && (
        <button type="button" className="oneway-flip" onClick={onFlip} title="Swap origin and destination">
          <span aria-hidden="true">⇅</span> Flip origin and destination
        </button>
      )}

      <div className="distance-card oneway-dest">
        <h3>Destination</h3>

        {!destAirport && (
          <>
            <div className="field-label">Distance from {homeCode || 'the origin'} (NM)</div>
            <RangeInputs range={destRange} label="Destination" onChange={onDestRangeChange} />
            <p className="oneway-hint oneway-hint-tight">
              {destCandidateCount > 0
                ? `${destCandidateCount} airport${destCandidateCount === 1 ? '' : 's'} match. Click one on the map (or in Results) and choose “Set as Destination”.`
                : 'No airports match this range and the current filters. Widen the range or relax the filters.'}
            </p>
          </>
        )}

        {destAirport && (
          <div className="oneway-dest-card">
            <strong>{destCode}</strong> – {destAirport.airport_name}
            <div>
              {destAirport.city}, {destAirport.state === 'unknown' ? 'N/A' : destAirport.state}
            </div>
            <div>
              Direct distance {homeCode} → {destCode}: {route.direct.toFixed(1)} NM
            </div>
            <button type="button" className="oneway-link" onClick={onClearDest}>
              Change destination
            </button>
          </div>
        )}
      </div>

      {!destAirport ? (
        <p className="empty-text">
          Set the distance range and click an airport on the map to choose where to go from {homeCode || 'the origin'}.
        </p>
      ) : (
        <div className="oneway-route">
          <h3>Route</h3>
          <p className="oneway-hint">
            Build the route one leg at a time from {homeCode} toward {destCode}. For each leg, set its minimum and maximum
            distance, then click an airport on the map (or in Results). Every airport inside the range is shown. When {destCode} falls inside the leg&apos;s range, finish the route there.
          </p>

          <div className="oneway-point oneway-point-a">
            <span className="oneway-badge">A</span>
            <strong>{homeCode}</strong>
          </div>

          {stops.map((stopCode, index) => (
            <div key={`stop-${stopCode}`}>
              {renderLeg(index, `Stop ${index + 1}`)}
              <div className="oneway-point oneway-stop">
                <span className="oneway-badge">{index + 1}</span>
                <strong>{stopCode}</strong>
                <span className="oneway-point-actions">
                  <button type="button" className="oneway-link" onClick={() => onClearFrom(index)}>
                    Clear
                  </button>
                </span>
              </div>
            </div>
          ))}

          {renderLeg(stops.length, finished ? destCode : `Stop ${stops.length + 1} or ${destCode}`)}

          {slotOpen && (
            <div className="oneway-point oneway-stop active">
              <span className="oneway-badge">{stops.length + 1}</span>
              <span className="oneway-pick">Pick stop {stops.length + 1} on the map</span>
            </div>
          )}
          {slotOpen && (
            <div className="oneway-remaining">
              {destCode} is {finishInfo.distance.toFixed(1)} NM from here
              {finishInfo.canFinish ? ' (inside this leg\'s range).' : ', outside this leg\'s range, so choose a stop.'}
              <div className="oneway-actions">
                <button
                  type="button"
                  className="primary-btn oneway-finish"
                  disabled={!finishInfo.canFinish}
                  onClick={onFinish}
                >
                  Finish adding stops
                </button>
                <button type="button" className="secondary-btn oneway-add" onClick={onAddStop}>
                  + Add stop
                </button>
              </div>
            </div>
          )}

          <div className="oneway-point oneway-point-b">
            <span className="oneway-badge">B</span>
            <strong>{destCode}</strong>
          </div>

          {problem && <div className="oneway-warn">{problem}</div>}

          <div className={`oneway-total${route.complete ? (route.allOk ? ' ok' : ' bad') : ''}`}>
            {route.complete
              ? `Route ${route.total.toFixed(1)} NM · Direct ${route.direct.toFixed(1)} NM (${formatDetour(route)}) · ${route.allOk ? 'ready for Summary Report' : 'a leg is outside its limits'}`
              : `${stops.length} stop${stops.length === 1 ? '' : 's'} chosen · ${finishInfo.distance.toFixed(1)} NM to ${destCode}`}
          </div>
        </div>
      )}
    </>
  );
}

export default function YourTripSection({ filters, setFilters, onMapReset, hasMapSelection, oneWay }) {
  // A triangle's total is at least twice its first leg, so airports beyond Total Trip max / 2 can never be chosen.
  // Raising the first leg (or switching to a triangle) therefore lifts Total Trip max to 2 x First Leg max when needed.
  const setField = (field, value) => setFilters((current) => {
    const next = { ...current, [field]: value };
    const touchesFirstLeg = field === 'firstLegMax' || (field === 'tripType' && value === 'two');
    if (touchesFirstLeg && next.tripType === 'two' && next.totalLegMax < next.firstLegMax * 2) {
      next.totalLegMax = next.firstLegMax * 2;
    }
    return next;
  });
  // A min/max pair is set together (RangeInputs already keeps max >= min + RANGE_GAP).
  const setRange = (minField, maxField, range) => setFilters((current) => {
    const next = { ...current, [minField]: range.min, [maxField]: range.max };
    if (next.tripType === 'two' && next.totalLegMax < next.firstLegMax * 2) next.totalLegMax = next.firstLegMax * 2;
    return next;
  });
  const totalTooSmall = filters.tripType === 'two' && filters.totalLegMax < filters.firstLegMax * 2;
  const isOneWay = filters.tripType === 'oneway';

  return (
    <section className="panel-section">
      <h2>Your Trip</h2>

      <div className="segmented">
        <button
          className={filters.tripType === 'one' ? 'active' : ''}
          onClick={() => setField('tripType', 'one')}
          type="button"
        >
          Round Trip
        </button>
        <button
          className={filters.tripType === 'two' ? 'active' : ''}
          onClick={() => setField('tripType', 'two')}
          type="button"
        >
          Triangle Trip
        </button>
        <button
          className={isOneWay ? 'active' : ''}
          onClick={() => setField('tripType', 'oneway')}
          type="button"
        >
          A → B
        </button>
      </div>

      {isOneWay && oneWay ? (
        <OneWayPlanner oneWay={oneWay} />
      ) : (
        <div className="distance-grid">
          <div className="distance-card">
            <h3>First Leg (NM)</h3>
            <RangeInputs
              range={{ min: filters.firstLegMin, max: filters.firstLegMax }}
              label="First leg"
              limit={500}
              onChange={(range) => setRange('firstLegMin', 'firstLegMax', range)}
            />
          </div>

          {filters.tripType === 'two' && (
            <div className="distance-card">
              <h3>Total Trip (NM)</h3>
              <RangeInputs
                range={{ min: filters.totalLegMin, max: filters.totalLegMax }}
                label="Total trip"
                limit={1500}
                onChange={(range) => setRange('totalLegMin', 'totalLegMax', range)}
              />
              {totalTooSmall && (
                <div className="oneway-warn">
                  Total Trip max is less than 2 × First Leg max, so airports farther than{' '}
                  {Math.floor(filters.totalLegMax / 2)} NM are hidden. Raise Total Trip max to {filters.firstLegMax * 2} NM or more.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!isOneWay && (
        <button type="button" className="secondary-btn full-width-btn" onClick={onMapReset} disabled={!hasMapSelection}>
          Map Reset
        </button>
      )}
    </section>
  );
}
