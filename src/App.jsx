import { useEffect, useMemo, useState } from 'react';
import BottomSheet from './components/BottomSheet';
import FiltersSection from './components/FiltersSection';
import HomeBaseSection from './components/HomeBaseSection';
import MapView from './components/MapView';
import ResultsSection from './components/ResultsSection';
import SummaryModal from './components/SummaryModal';
import YourTripSection from './components/YourTripSection';
import { useAirportData } from './hooks/useAirportData';
import {
  findFirstLegDestinations,
  findFilteredInRangeFirstLegDestinations,
  findNearbyOuterFirstLegDestinations,
  findSecondLegDestinations,
} from './utils/filtering';

const defaultFilters = {
  surfaces: ['ASPH', 'CONC'],
  airspaces: ['D', 'E', 'G'],
  approaches: ['RNAV', 'ILS/LOC', 'VOR/NDB'],
  minRunwayLength: 3000,
  maxAirportElev: 6000,
  mustHaveFuel: true,
  firstLegMin: 50,
  firstLegMax: 100,
  totalLegMin: 150,
  totalLegMax: 200,
  tripType: 'one',
  sortBy: 'leg_distance',
};

const panelTabs = [
  { id: 'plan', label: 'Plan' },
  { id: 'filters', label: 'Filters' },
  { id: 'results', label: 'Results' },
];
const APP_VERSION = 'v2.0';

export default function App() {
  const { airportData, databaseVersion, loading, error, locationIndex, loadAirportDetails } = useAirportData();
  const [filters, setFilters] = useState(defaultFilters);
  const [selectedCountry, setSelectedCountry] = useState('US');
  const [selectedState, setSelectedState] = useState('');
  const [selectedAirportCode, setSelectedAirportCode] = useState(() => localStorage.getItem('defaultHomeBase') || '');
  const [selectedFirstLegCode, setSelectedFirstLegCode] = useState('');
  const [selectedSecondLegCode, setSelectedSecondLegCode] = useState('');
  const [activeLegInfo, setActiveLegInfo] = useState(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [sheetState, setSheetState] = useState('half');
  const [homeRestored, setHomeRestored] = useState(false);
  const [activePanelTab, setActivePanelTab] = useState('plan');

  const countries = locationIndex.countries;
  const states = useMemo(() => {
    const set = locationIndex.statesByCountry[selectedCountry];
    return set ? [...set].sort() : [];
  }, [locationIndex, selectedCountry]);

  const airports = useMemo(() => {
    const key = `${selectedCountry}-${selectedState}`;
    return (locationIndex.airportsByState[key] || []).slice().sort((a, b) => a.code.localeCompare(b.code));
  }, [locationIndex, selectedCountry, selectedState]);

  const selectedAirport = airportData[selectedAirportCode] || null;
  const selectedAirportWithCode = selectedAirport
    ? { ...selectedAirport, airport_code: selectedAirport.airport_code || selectedAirportCode }
    : null;
  const firstLegResults = useMemo(
    () => findFirstLegDestinations(airportData, selectedAirportCode, filters),
    [airportData, selectedAirportCode, filters]
  );
  const filteredInRangeResults = useMemo(
    () => findFilteredInRangeFirstLegDestinations(airportData, selectedAirportCode, filters),
    [airportData, selectedAirportCode, filters]
  );
  const nearbyOuterResults = useMemo(
    () => findNearbyOuterFirstLegDestinations(airportData, selectedAirportCode, filters),
    [airportData, selectedAirportCode, filters]
  );
  const secondLegResults = useMemo(() => {
    if (filters.tripType !== 'two' || !selectedFirstLegCode) return [];
    return findSecondLegDestinations(airportData, selectedAirportCode, selectedFirstLegCode, filters);
  }, [airportData, selectedAirportCode, selectedFirstLegCode, filters]);

  useEffect(() => {
    if (countries.length === 0) return;

    const savedHome = localStorage.getItem('defaultHomeBase');
    if (savedHome && airportData[savedHome]) {
      const airport = airportData[savedHome];
      setSelectedCountry(airport.country || 'US');
      setSelectedState(airport.state || 'unknown');
      setSelectedAirportCode(savedHome);
      setHomeRestored(true);
      return;
    }

    const defaultCountry = countries.includes('US') ? 'US' : countries[0];
    setSelectedCountry(defaultCountry);
    setHomeRestored(true);
  }, [countries, airportData]);

  useEffect(() => {
    if (!homeRestored) return;
    if (!selectedCountry || states.length === 0) return;
    if (!states.includes(selectedState)) setSelectedState(states[0]);
  }, [homeRestored, selectedCountry, states, selectedState]);

  useEffect(() => {
    if (!homeRestored) return;
    if (airports.length === 0) return;
    if (!airports.some((airport) => airport.code === selectedAirportCode)) {
      setSelectedAirportCode(airports[0].code);
    }
  }, [homeRestored, airports, selectedAirportCode]);

  useEffect(() => {
    if (!homeRestored) return;
    if (selectedAirportCode) {
      localStorage.setItem('defaultHomeBase', selectedAirportCode);
    }
  }, [homeRestored, selectedAirportCode]);

  useEffect(() => {
    setSelectedFirstLegCode('');
    setSelectedSecondLegCode('');
    setActiveLegInfo(null);
  }, [selectedAirportCode, filters]);

  useEffect(() => {
    setSelectedSecondLegCode('');
  }, [selectedFirstLegCode]);

  useEffect(() => {
    if (selectedAirportCode) {
      loadAirportDetails(selectedAirportCode);
    }
  }, [selectedAirportCode, loadAirportDetails]);

  useEffect(() => {
    const codes = [selectedFirstLegCode];
    if (selectedSecondLegCode) {
      codes.push(selectedSecondLegCode);
    }
    if (codes.length > 0) {
      loadAirportDetails(codes);
    }
  }, [selectedFirstLegCode, selectedSecondLegCode, loadAirportDetails]);

  const handleSelectFirstLeg = (code) => {
    setSelectedFirstLegCode(code);
    setSelectedSecondLegCode('');
    setActiveLegInfo({ type: 'first', code });
    setActivePanelTab('results');
    if (filters.tripType === 'two') setSheetState('half');
  };

  const handleSelectFirstLegOnMap = (code) => {
    setSelectedFirstLegCode(code);
    setSelectedSecondLegCode('');
    setActiveLegInfo({ type: 'first', code });
    setActivePanelTab('results');
  };

  const handleSelectSecondLeg = (code) => {
    setSelectedSecondLegCode(code);
    setActiveLegInfo({ type: 'second', code });
    setActivePanelTab('results');
  };

  const handleMapReset = () => {
    setSelectedFirstLegCode('');
    setSelectedSecondLegCode('');
    setActiveLegInfo(null);
    setSummaryOpen(false);
  };

  const panelHeader = (
    <>
      <div className="title-block">
        <h1
          className="title-heading-button"
          role="button"
          tabIndex={0}
          title="Click for credits"
          onClick={() => setCreditsOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setCreditsOpen(true);
            }
          }}
        >
          <span className="title-mark">🛫</span>
          <span className="title-text">Cross Country Flight Planner</span>
        </h1>
        <div className="subtle-line">App version: {APP_VERSION}</div>
        <div className="subtle-line">FAA Database as of: {databaseVersion}</div>
      </div>
      <div className="panel-tabs" role="tablist" aria-label="Planner sections">
        {panelTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activePanelTab === tab.id}
            className={`panel-tab-btn ${activePanelTab === tab.id ? 'active' : ''}`}
            onClick={() => setActivePanelTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </>
  );

  const panelFooter = (
    <div className="footer-actions">
      <button
        type="button"
        className="primary-btn"
        disabled={!selectedFirstLegCode}
        onClick={() => setSummaryOpen(true)}
      >
        Summary Report
      </button>
    </div>
  );

  const desktopPanel = (
    <>
      {panelHeader}
      {activePanelTab === 'plan' && (
        <>
          <HomeBaseSection
            countries={countries}
            states={states}
            airports={airports}
            selectedCountry={selectedCountry}
            selectedState={selectedState}
            selectedAirportCode={selectedAirportCode}
            onCountryChange={setSelectedCountry}
            onStateChange={setSelectedState}
            onAirportChange={setSelectedAirportCode}
            selectedAirport={selectedAirportWithCode}
          />
          <YourTripSection
            filters={filters}
            setFilters={setFilters}
            onMapReset={handleMapReset}
            hasMapSelection={Boolean(selectedFirstLegCode || selectedSecondLegCode)}
          />
        </>
      )}
      {activePanelTab === 'filters' && <FiltersSection filters={filters} setFilters={setFilters} />}
      {activePanelTab === 'results' && (
        <ResultsSection
          airportData={airportData}
          firstLegResults={firstLegResults}
        secondLegResults={secondLegResults}
        selectedFirstLegCode={selectedFirstLegCode}
        selectedSecondLegCode={selectedSecondLegCode}
        filters={filters}
        setFilters={setFilters}
        onSelectFirstLeg={handleSelectFirstLeg}
        onSelectSecondLeg={handleSelectSecondLeg}
      />
      )}
      {panelFooter}
    </>
  );

  const mobilePanel = (
    <>
      {panelHeader}
      {activePanelTab === 'plan' && (
        <>
          <HomeBaseSection
            countries={countries}
            states={states}
            airports={airports}
            selectedCountry={selectedCountry}
            selectedState={selectedState}
            selectedAirportCode={selectedAirportCode}
            onCountryChange={setSelectedCountry}
            onStateChange={setSelectedState}
            onAirportChange={setSelectedAirportCode}
            selectedAirport={selectedAirportWithCode}
          />
          <YourTripSection
            filters={filters}
            setFilters={setFilters}
            onMapReset={handleMapReset}
            hasMapSelection={Boolean(selectedFirstLegCode || selectedSecondLegCode)}
          />
        </>
      )}
      {activePanelTab === 'filters' && <FiltersSection filters={filters} setFilters={setFilters} />}
      {activePanelTab === 'results' && (
        <ResultsSection
          airportData={airportData}
          firstLegResults={firstLegResults}
          secondLegResults={secondLegResults}
          selectedFirstLegCode={selectedFirstLegCode}
          selectedSecondLegCode={selectedSecondLegCode}
          filters={filters}
          setFilters={setFilters}
          onSelectFirstLeg={handleSelectFirstLeg}
          onSelectSecondLeg={handleSelectSecondLeg}
        />
      )}
      {panelFooter}
    </>
  );

  if (loading) {
    return <div className="status-screen">Loading airport database…</div>;
  }

  if (error) {
    return <div className="status-screen">Failed to load airport database: {error}</div>;
  }

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar">{desktopPanel}</aside>
      <main className="map-shell">
        <MapView
          homeAirport={selectedAirportWithCode}
          filters={filters}
          firstLegResults={firstLegResults}
          filteredInRangeResults={filteredInRangeResults}
          nearbyOuterResults={nearbyOuterResults}
          secondLegResults={secondLegResults}
          selectedFirstLegCode={selectedFirstLegCode}
          selectedSecondLegCode={selectedSecondLegCode}
          activeLegInfo={activeLegInfo}
          onSelectFirstLeg={handleSelectFirstLegOnMap}
          onSelectSecondLeg={handleSelectSecondLeg}
          onOpenSummary={() => setSummaryOpen(true)}
          airportData={airportData}
          onRequestAirportDetails={loadAirportDetails}
        />
      </main>

      <div className="mobile-only">
        <BottomSheet state={sheetState} setState={setSheetState}>
          {mobilePanel}
        </BottomSheet>
      </div>

      <SummaryModal
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        airportData={airportData}
        loadAirportDetails={loadAirportDetails}
        homeCode={selectedAirportCode}
        firstLegCode={selectedFirstLegCode}
        secondLegCode={selectedSecondLegCode}
        tripType={filters.tripType}
      />

      {creditsOpen && (
        <div className="modal-backdrop" onClick={() => setCreditsOpen(false)}>
          <div className="modal-card credits-card" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setCreditsOpen(false)}>
              ×
            </button>
            <h2>Credits</h2>
            <div className="credits-lines">
              <div>Cross Country Flight Planner</div>
              <div>App version: {APP_VERSION}</div>
              <div>FAA Database as of: {databaseVersion}</div>
              <div>Map data © OpenStreetMap contributors</div>
              <div>Built with React, Vite, Leaflet, and a lot of care.</div>
              <div>© 2026 pilot.drchoi@gmail.com. All rights reserved.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
