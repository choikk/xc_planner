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
}) {
  const setSortBy = (value) => setFilters((current) => ({ ...current, sortBy: value }));

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
