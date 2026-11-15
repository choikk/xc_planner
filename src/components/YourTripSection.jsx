function LegLimitInputs({ leg, index, onChange }) {
  return (
    <div className="dual-inputs">
      <input
        type="number"
        aria-label={`Leg ${index + 1} minimum NM`}
        value={leg.min}
        min="0"
        max="2000"
        step="10"
        onChange={(e) => onChange(index, 'min', Number(e.target.value))}
      />
      <span>-</span>
      <input
        type="number"
        aria-label={`Leg ${index + 1} maximum NM`}
        value={leg.max}
        min="0"
        max="2000"
        step="10"
        onChange={(e) => onChange(index, 'max', Number(e.target.value))}
      />
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
    destCode,
    destAirport,
    slotOpen,
    destRange,
    destCandidateCount,
    onDestRangeChange,
    onClearDest,
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
        <LegLimitInputs leg={legs[index]} index={index} onChange={onLegChange} />
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
            <div className="oneway-hint oneway-hint-tight">Change the origin in the Home tab.</div>
          </div>
        ) : (
          <p className="empty-text">Select a home base in the Home tab.</p>
        )}
      </div>

      <div className="distance-card oneway-dest">
        <h3>Destination</h3>

        {!destAirport && (
          <>
            <div className="field-label">Distance from {homeCode || 'the origin'} (NM)</div>
            <div className="dual-inputs">
              <input
                type="number"
                aria-label="Destination minimum NM"
                value={destRange.min}
                min="0"
                max="5000"
                step="50"
                onChange={(e) => onDestRangeChange('min', Number(e.target.value))}
              />
              <span>-</span>
              <input
                type="number"
                aria-label="Destination maximum NM"
                value={destRange.max}
                min="0"
                max="5000"
                step="50"
                onChange={(e) => onDestRangeChange('max', Number(e.target.value))}
              />
            </div>
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
  const setField = (field, value) => setFilters((current) => ({ ...current, [field]: value }));
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
            <div className="dual-inputs">
              <input
                type="number"
                value={filters.firstLegMin}
                min="10"
                max="500"
                step="10"
                onChange={(e) => setField('firstLegMin', Number(e.target.value))}
              />
              <span>-</span>
              <input
                type="number"
                value={filters.firstLegMax}
                min="10"
                max="500"
                step="10"
                onChange={(e) => setField('firstLegMax', Number(e.target.value))}
              />
            </div>
          </div>

          {filters.tripType === 'two' && (
            <div className="distance-card">
              <h3>Total Trip (NM)</h3>
              <div className="dual-inputs">
                <input
                  type="number"
                  value={filters.totalLegMin}
                  min="20"
                  max="1500"
                  step="10"
                  onChange={(e) => setField('totalLegMin', Number(e.target.value))}
                />
                <span>-</span>
                <input
                  type="number"
                  value={filters.totalLegMax}
                  min="20"
                  max="1500"
                  step="10"
                  onChange={(e) => setField('totalLegMax', Number(e.target.value))}
                />
              </div>
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
