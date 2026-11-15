const stateAbbreviations = {
  ALABAMA: 'AL',
  ALASKA: 'AK',
  ARIZONA: 'AZ',
  ARKANSAS: 'AR',
  CALIFORNIA: 'CA',
  COLORADO: 'CO',
  CONNECTICUT: 'CT',
  DELAWARE: 'DE',
  FLORIDA: 'FL',
  GEORGIA: 'GA',
  HAWAII: 'HI',
  IDAHO: 'ID',
  ILLINOIS: 'IL',
  INDIANA: 'IN',
  IOWA: 'IA',
  KANSAS: 'KS',
  KENTUCKY: 'KY',
  LOUISIANA: 'LA',
  MAINE: 'ME',
  MARYLAND: 'MD',
  MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI',
  MINNESOTA: 'MN',
  MISSISSIPPI: 'MS',
  MISSOURI: 'MO',
  MONTANA: 'MT',
  NEBRASKA: 'NE',
  NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  OREGON: 'OR',
  PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN',
  TEXAS: 'TX',
  UTAH: 'UT',
  VERMONT: 'VT',
  VIRGINIA: 'VA',
  WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI',
  WYOMING: 'WY',
  'DISTRICT OF COLUMBIA': 'DC',
  'PUERTO RICO': 'PR',
  GUAM: 'GU',
  'VIRGIN ISLANDS': 'VI',
  'NORTHERN MARIANA ISLANDS': 'MP',
  'N MARIANA ISLANDS': 'MP',
  AMERICAN_SAMOA: 'AS',
  'AMERICAN SAMOA': 'AS',
  PALMYRA: 'UM',
  'PALMYRA ATOLL': 'UM',
  'WAKE ISLAND': 'UM',
};

function formatStateCode(state) {
  const normalized = String(state || '').trim().toUpperCase();
  if (!normalized) return '';
  if (normalized.length === 2) return normalized;
  return stateAbbreviations[normalized] || state;
}

function ResultCard({ code, name, distance, active, onClick, children }) {
  return (
    <button type="button" className={`result-card ${active ? 'active' : ''}`} onClick={onClick}>
      <div className="result-card-head">
        <div className="result-card-title-row">
          <strong>{code}</strong>
          <span>{name}</span>
        </div>
        <div className="result-card-distance">{distance}</div>
      </div>
      {children}
    </button>
  );
}

export default function ResultsSection({
  airportData,
  firstLegResults,
  secondLegResults,
  selectedFirstLegCode,
  selectedSecondLegCode,
  filters,
  setFilters,
  onSelectFirstLeg,
  onSelectSecondLeg,
  oneWay = null,
}) {
  const setSortBy = (value) => setFilters((current) => ({ ...current, sortBy: value }));

  if (oneWay?.active) {
    const { candidates, activeIndex, slotOpen, originCode, destCode, legs, route, onSelectStop } = oneWay;
    const leg = legs[activeIndex] || { min: 0, max: 0 };

    return (
      <section className="panel-section">
        <div className="sort-row">
          <span>Sort by</span>
          <select value={filters.sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="leg_distance">Leg Distance</option>
            <option value="total_distance">Distance to Destination</option>
            <option value="alphabetical">Alphabetical</option>
          </select>
        </div>

        {!destCode && oneWay.destPicking ? (
          <>
            <h2>Destination Candidates</h2>
            <p className="oneway-hint">
              {oneWay.destRange.min}–{oneWay.destRange.max} NM from {originCode}. Click an airport to choose it as the destination.
            </p>
            <div className="results-stack">
              {oneWay.destCandidates.length === 0 ? (
                <p className="empty-text">No airports match this range and the current filters.</p>
              ) : (
                oneWay.destCandidates.map((result) => {
                  const airport = airportData[result.code];
                  return (
                    <ResultCard
                      key={result.code}
                      code={result.code}
                      name={`${airport.airport_name} — ${airport.city}, ${formatStateCode(airport.state)}`}
                      distance={`${result.distance.toFixed(1)} NM`}
                      active={false}
                      onClick={() => oneWay.onSelectDest(result.code)}
                    >
                      <div>Class {airport.airspace} · Fuel {airport.fuel}</div>
                    </ResultCard>
                  );
                })
              )}
            </div>
          </>
        ) : !destCode ? (
          <p className="empty-text">Choose a destination in the Plan tab to see stop candidates.</p>
        ) : slotOpen ? (
          <>
            <h2>
              Stop {activeIndex + 1} Candidates
            </h2>
            <p className="oneway-hint">
              {leg.min}–{leg.max} NM from {originCode}, closer to {destCode} than {originCode} is.
            </p>
            <div className="results-stack">
              {oneWay.finishInfo?.canFinish && (
                <ResultCard
                  key="finish"
                  code={destCode}
                  name={`Finish adding stops — ${airportData[destCode]?.airport_name || ''}`}
                  distance={`${oneWay.finishInfo.distance.toFixed(1)} NM`}
                  active
                  onClick={() => oneWay.onFinish()}
                >
                  <div>{destCode} is inside this leg&apos;s range.</div>
                </ResultCard>
              )}
              {candidates.length === 0 && !oneWay.finishInfo?.canFinish ? (
                <p className="empty-text">
                  {oneWay.problem
                    ? oneWay.problem
                    : 'No airports match this leg. Widen the leg limits or relax the filters.'}
                </p>
              ) : (
                candidates.map((result) => {
                  const airport = airportData[result.code];
                  return (
                    <ResultCard
                      key={result.code}
                      code={result.code}
                      name={`${airport.airport_name} — ${airport.city}, ${formatStateCode(airport.state)}`}
                      distance={`${result.distance.toFixed(1)} NM`}
                      active={false}
                      onClick={() => onSelectStop(result.code)}
                    >
                      <div>
                        To {destCode}: {result.toDest.toFixed(1)} NM · Class {airport.airspace} · Fuel {airport.fuel}
                      </div>
                      {result.toDest >= leg.min && result.toDest <= leg.max && (
                        <div className="result-card-note">{destCode} is reachable with the next leg ✓</div>
                      )}
                    </ResultCard>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <>
            <h2>Route</h2>
            <div className="results-stack">
              {route.segments.map((segment) => (
                <div key={`${segment.from}-${segment.to}`} className={`oneway-leg-result ${segment.ok ? 'ok' : 'bad'}`}>
                  {segment.from} → {segment.to}: {segment.distance.toFixed(1)} NM{segment.mc ? ` · MC ${segment.mc}°` : ''}
                  {segment.ok ? ' ✓' : ` (limit ${segment.min}–${segment.max} NM)`}
                </div>
              ))}
              {route.complete && (
                <div className="oneway-total">
                  Route {route.total.toFixed(1)} NM · Direct {route.direct.toFixed(1)} NM
                </div>
              )}
            </div>
            <p className="oneway-hint">
              {route.allOk
                ? 'All stops are chosen. Use Summary Report for the trip summary.'
                : 'Adjust the leg limits or clear a stop to continue.'}
            </p>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="panel-section">
      <div className="sort-row">
        <span>Sort by</span>
        <select value={filters.sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="leg_distance">Leg Distance</option>
          <option value="total_distance">Total Distance</option>
          <option value="alphabetical">Alphabetical</option>
        </select>
      </div>

      <h2>Matching Airports</h2>
      <div className="results-stack">
        {firstLegResults.length === 0 ? (
          <p className="empty-text">No destinations match the current home base and filters.</p>
        ) : (
          firstLegResults.map((result) => {
            const airport = airportData[result.code];
            return (
              <ResultCard
                key={result.code}
                code={result.code}
                name={`${airport.airport_name} — ${airport.city}, ${formatStateCode(airport.state)}`}
                distance={`${result.distance.toFixed(1)} NM`}
                active={selectedFirstLegCode === result.code}
                onClick={() => onSelectFirstLeg(result.code)}
              >
                <div>Class {airport.airspace} · Fuel {airport.fuel}</div>
              </ResultCard>
            );
          })
        )}
      </div>

      {filters.tripType === 'two' && (
        <>
          <h2>Second Leg Destinations</h2>
          <div className="results-stack">
            {secondLegResults.length === 0 ? (
              <p className="empty-text">
                {selectedFirstLegCode
                  ? 'No second-leg destinations match the current triangle filters.'
                  : 'Select a first-leg destination to display second-leg options.'}
              </p>
            ) : (
              secondLegResults.map((result) => {
                const airport = airportData[result.code];
                return (
                  <ResultCard
                    key={result.code}
                    code={result.code}
                    name={`${airport.airport_name} — ${airport.city}, ${formatStateCode(airport.state)}`}
                    distance={`${result.totalDistance.toFixed(1)} NM total`}
                    active={selectedSecondLegCode === result.code}
                    onClick={() => onSelectSecondLeg(result.code)}
                  >
                    <div>
                      Leg 2: {result.leg2Distance.toFixed(1)} NM · Return: {result.leg3Distance.toFixed(1)} NM
                    </div>
                    <div>Class {airport.airspace}</div>
                  </ResultCard>
                );
              })
            )}
          </div>
        </>
      )}
    </section>
  );
}
