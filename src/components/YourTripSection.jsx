export default function YourTripSection({ filters, setFilters, onMapReset, hasMapSelection }) {
  const setField = (field, value) => setFilters((current) => ({ ...current, [field]: value }));

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
      </div>

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

      <button type="button" className="secondary-btn full-width-btn" onClick={onMapReset} disabled={!hasMapSelection}>
        Map Reset
      </button>
    </section>
  );
}
