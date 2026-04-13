import CustomSelect from './CustomSelect';

export default function HomeBaseSection({
  countries,
  states,
  airports,
  selectedCountry,
  selectedState,
  selectedAirportCode,
  onCountryChange,
  onStateChange,
  onAirportChange,
  selectedAirport,
}) {
  const countryOptions = countries.map((country) => ({ value: country, label: country }));
  const stateOptions = states.map((state) => ({ value: state, label: state }));
  const airportOptions = airports.map((airport) => ({
    value: airport.code,
    label: `${airport.code} - ${airport.name}`,
  }));

  return (
    <section className="panel-section">
      <h2>Home Base Airport</h2>
      <div className="field-label">Country</div>
      <CustomSelect
        value={selectedCountry}
        options={countryOptions}
        onChange={onCountryChange}
        ariaLabel="Country"
      />

      <div className="field-label">State</div>
      <CustomSelect
        value={selectedState}
        options={stateOptions}
        onChange={onStateChange}
        ariaLabel="State"
      />

      <div className="field-label">Airport</div>
      <CustomSelect
        value={selectedAirportCode}
        options={airportOptions}
        onChange={onAirportChange}
        ariaLabel="Airport"
      />

      {selectedAirport && (
        <div className="home-base-card">
          <strong>
            {selectedAirport.airport_code} - {selectedAirport.airport_name}
          </strong>
          <div>
            {selectedAirport.city}, {selectedAirport.state === 'unknown' ? 'N/A' : selectedAirport.state},{' '}
            {selectedAirport.country}
          </div>
          <div>Elevation: {selectedAirport.elevation} ft</div>
          <div>Fuel: {selectedAirport.fuel}</div>
          <div>Airspace: {selectedAirport.airspace}</div>
          <div className="runway-list">
            <strong>Runways</strong>
            {selectedAirport.runways.map((runway) => (
              <div key={`${selectedAirport.airport_code}-${runway.rwy_id}`}>
                {runway.rwy_id}: {runway.length} ft, {runway.surface}, {runway.condition}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
