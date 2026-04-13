const surfaceOptions = ['ASPH', 'CONC', 'TURF', 'OTHER'];
const airspaceOptions = ['B', 'C', 'D', 'E', 'G'];
const approachOptions = ['RNAV', 'ILS/LOC', 'VOR/NDB', 'None'];

function CheckboxGroup({ values, selected, onToggle, labelMap = {} }) {
  return (
    <div className="checkbox-grid">
      {values.map((value) => (
        <label key={value} className="checkbox-chip">
          <input type="checkbox" checked={selected.includes(value)} onChange={() => onToggle(value)} />
          <span>{labelMap[value] || value}</span>
        </label>
      ))}
    </div>
  );
}

export default function FiltersSection({ filters, setFilters }) {
  const toggleArrayValue = (field, value) => {
    setFilters((current) => ({
      ...current,
      [field]: current[field].includes(value)
        ? current[field].filter((item) => item !== value)
        : [...current[field], value],
    }));
  };

  const setField = (field, value) => setFilters((current) => ({ ...current, [field]: value }));

  return (
    <section className="panel-section">
      <h2>Destination Filters</h2>
      <label className="toggle-line filter-toggle-top">
        <input
          type="checkbox"
          checked={filters.mustHaveFuel}
          onChange={(e) => setField('mustHaveFuel', e.target.checked)}
        />
        <span>Fuel service required</span>
      </label>

      <details open>
        <summary>Surface Type</summary>
        <CheckboxGroup
          values={surfaceOptions}
          selected={filters.surfaces}
          onToggle={(value) => toggleArrayValue('surfaces', value)}
          labelMap={{ ASPH: 'Asphalt', CONC: 'Concrete', TURF: 'Grass', OTHER: 'Other' }}
        />
      </details>

      <details open>
        <summary>Airspace Classes</summary>
        <CheckboxGroup
          values={airspaceOptions}
          selected={filters.airspaces}
          onToggle={(value) => toggleArrayValue('airspaces', value)}
          labelMap={{ B: 'Class B', C: 'Class C', D: 'Class D', E: 'Class E', G: 'Class G' }}
        />
      </details>

      <details open>
        <summary>Instrument Approaches</summary>
        <CheckboxGroup
          values={approachOptions}
          selected={filters.approaches}
          onToggle={(value) => toggleArrayValue('approaches', value)}
        />
      </details>

      <div className="stack-row">
        <label>
          Minimum Runway Length
          <input
            type="range"
            min="500"
            max="15000"
            step="100"
            value={filters.minRunwayLength}
            onChange={(e) => setField('minRunwayLength', Number(e.target.value))}
          />
          <span>{filters.minRunwayLength} ft</span>
        </label>
        <label>
          Maximum Field Elevation
          <input
            type="range"
            min="1000"
            max="10000"
            step="100"
            value={filters.maxAirportElev}
            onChange={(e) => setField('maxAirportElev', Number(e.target.value))}
          />
          <span>{filters.maxAirportElev} ft</span>
        </label>
      </div>
    </section>
  );
}
