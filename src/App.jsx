import { useEffect, useMemo, useState } from 'react';
import BottomSheet from './components/BottomSheet';
import FiltersSection from './components/FiltersSection';
import HomeBaseSection from './components/HomeBaseSection';
import MapView from './components/MapView';
import ResultsSection from './components/ResultsSection';
import SummaryModal from './components/SummaryModal';
import YourTripSection from './components/YourTripSection';
import { useAirportData } from './hooks/useAirportData';
import { useVisitors } from './hooks/useVisitors';
import { formatNasrEffective, formatNasrEffectiveShort } from './utils/nasr';
import {
  findFirstLegDestinations,
  findFilteredInRangeFirstLegDestinations,
  findNearbyOuterFirstLegDestinations,
  findSecondLegDestinations,
  findOneWayStopCandidates,
  findDestinationCandidates,
  describeOneWayStuck,
  oneWayFinishInfo,
  validateOneWayRoute,
  buildOneWaySegments,
} from './utils/filtering';

const defaultFilters = {
  surfaces: ['ASPH', 'CONC'],
  airspaces: ['D', 'E', 'G'],
  approaches: ['RNAV', 'ILS/LOC', 'VOR/NDB'],
  minRunwayLength: 3000,
  maxAirportElev: 6000,
  mustHaveFuel: true,
  excludeNonPublic: true,
  firstLegMin: 50,
  firstLegMax: 100,
  totalLegMin: 150,
  totalLegMax: 200,
  tripType: 'one',
  sortBy: 'leg_distance',
};

const DEFAULT_ONE_WAY_LEG = { min: 50, max: 150 };

const panelTabs = [
  { id: 'home', label: 'Home' },
  { id: 'plan', label: 'Plan' },
  { id: 'filters', label: 'Filters' },
  { id: 'results', label: 'Results' },
];
const APP_VERSION = 'v2611.15';

export default function App() {
  const { airportData, databaseVersion, loading, error, locationIndex, loadAirportDetails } = useAirportData();
  const visitors = useVisitors();
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
  const [activePanelTab, setActivePanelTab] = useState('home');
  // One-way (A -> B) planning: destination, per-leg distance limits and the stops picked so far.
  const [destCode, setDestCode] = useState('');
  const [destRange, setDestRange] = useState({ min: 100, max: 500 });
  const [oneWayLegs, setOneWayLegs] = useState([DEFAULT_ONE_WAY_LEG]);
  const [oneWayStops, setOneWayStops] = useState([]);
  const [oneWayFinished, setOneWayFinished] = useState(false);
  const isOneWay = filters.tripType === 'oneway';

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
  const destAirport = useMemo(
    () => (destCode && airportData[destCode] ? { ...airportData[destCode], airport_code: destCode } : null),
    [airportData, destCode]
  );
  const selectedAirportWithCode = selectedAirport
    ? { ...selectedAirport, airport_code: selectedAirport.airport_code || selectedAirportCode }
    : null;
  const firstLegResults = useMemo(
    () => (isOneWay ? [] : findFirstLegDestinations(airportData, selectedAirportCode, filters)),
    [airportData, selectedAirportCode, filters]
  );
  const filteredInRangeResults = useMemo(
    () => (isOneWay ? [] : findFilteredInRangeFirstLegDestinations(airportData, selectedAirportCode, filters)),
    [airportData, selectedAirportCode, filters]
  );
  const nearbyOuterResults = useMemo(
    () => (isOneWay ? [] : findNearbyOuterFirstLegDestinations(airportData, selectedAirportCode, filters)),
    [airportData, selectedAirportCode, filters]
  );
  const secondLegResults = useMemo(() => {
    if (filters.tripType !== 'two' || !selectedFirstLegCode) return [];
    return findSecondLegDestinations(airportData, selectedAirportCode, selectedFirstLegCode, filters);
  }, [airportData, selectedAirportCode, selectedFirstLegCode, filters]);

  // The part of the chosen route that is still valid for the current leg limits, filters, home base and destination.
  const oneWayValid = useMemo(() => {
    if (!isOneWay || !destAirport) return { stops: [], finished: false };
    return validateOneWayRoute(airportData, selectedAirportCode, destCode, oneWayLegs, oneWayStops, oneWayFinished, filters);
  }, [isOneWay, airportData, selectedAirportCode, destCode, destAirport, oneWayLegs, oneWayStops, oneWayFinished, filters]);
  const effectiveStops = oneWayValid.stops;
  const oneWayDone = oneWayValid.finished;

  useEffect(() => {
    if (effectiveStops.length !== oneWayStops.length) {
      setOneWayStops(effectiveStops);
      setOneWayLegs((current) => current.slice(0, effectiveStops.length + 1));
    }
    if (oneWayFinished !== oneWayDone) setOneWayFinished(oneWayDone);
  }, [effectiveStops, oneWayStops, oneWayDone, oneWayFinished]);

  const destPicking = Boolean(isOneWay && !destCode && selectedAirport);
  const destCandidates = useMemo(() => {
    if (!destPicking) return [];
    return findDestinationCandidates(airportData, selectedAirportCode, destRange, filters);
  }, [destPicking, airportData, selectedAirportCode, destRange, filters]);

  const oneWayActiveIndex = effectiveStops.length;
  const oneWayLeg = oneWayLegs[oneWayActiveIndex] || DEFAULT_ONE_WAY_LEG;
  // A next step is open until the route has been finished at B.
  const oneWaySlotOpen = Boolean(isOneWay && destAirport && selectedAirport && !oneWayDone);
  const oneWayOriginCode = effectiveStops.length ? effectiveStops[effectiveStops.length - 1] : selectedAirportCode;
  const oneWayFinish = useMemo(() => {
    if (!oneWaySlotOpen) return { distance: 0, canFinish: false };
    return oneWayFinishInfo(airportData, oneWayOriginCode, destCode, oneWayLeg);
  }, [oneWaySlotOpen, airportData, oneWayOriginCode, destCode, oneWayLeg]);
  const oneWayCandidates = useMemo(() => {
    if (!oneWaySlotOpen) return [];
    return findOneWayStopCandidates(airportData, {
      originCode: oneWayOriginCode,
      destCode,
      leg: oneWayLeg,
      filters,
      excludeCodes: effectiveStops,
    });
  }, [oneWaySlotOpen, airportData, oneWayOriginCode, destCode, oneWayLeg, filters, effectiveStops]);
  const oneWayProblem = useMemo(() => {
    if (!oneWaySlotOpen || oneWayFinish.canFinish || oneWayCandidates.length > 0) return '';
    return describeOneWayStuck(airportData, oneWayOriginCode, destCode, oneWayLeg);
  }, [oneWaySlotOpen, oneWayFinish, oneWayCandidates, airportData, oneWayOriginCode, destCode, oneWayLeg]);
  const oneWayRoute = useMemo(() => {
    if (!isOneWay || !destAirport || !selectedAirport) {
      return { segments: [], complete: false, direct: 0, total: 0, allOk: false };
    }
    return buildOneWaySegments(airportData, selectedAirportCode, destCode, oneWayLegs, effectiveStops, oneWayDone);
  }, [isOneWay, airportData, selectedAirportCode, selectedAirport, destCode, destAirport, oneWayLegs, effectiveStops, oneWayDone]);
  const oneWayCodes = oneWayRoute.complete ? [selectedAirportCode, ...effectiveStops, destCode] : [];
  const summaryReady = isOneWay ? oneWayRoute.allOk : Boolean(selectedFirstLegCode);

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
    setOneWayStops([]);
    setOneWayLegs((current) => current.slice(0, 1));
    setOneWayFinished(false);
  }, [selectedAirportCode, destCode]);

  useEffect(() => {
    if (destCode) loadAirportDetails(destCode);
  }, [destCode, loadAirportDetails]);

  // A saved home airport is selected on the first render, before the airport list has loaded.
  // Re-run once the list contains it, otherwise its runways would stay on "Loading airport details...".
  const homeAirportKnown = Boolean(airportData[selectedAirportCode]);
  useEffect(() => {
    if (selectedAirportCode && homeAirportKnown) {
      loadAirportDetails(selectedAirportCode);
    }
  }, [selectedAirportCode, homeAirportKnown, loadAirportDetails]);

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

  const handleSelectDestination = (code) => {
    const airport = airportData[code];
    if (!airport) return;
    setDestCode(code);
    loadAirportDetails(code);
  };

  const handleDestRangeChange = (range) => {
    setDestRange({ min: range.min, max: range.max });
  };

  const handleSelectOneWayStop = (code) => {
    if (!oneWaySlotOpen) return;
    const index = effectiveStops.length;
    setOneWayStops([...effectiveStops, code]);
    // The next leg starts with the same limits as the one just used.
    setOneWayLegs((current) => [...current.slice(0, index + 1), { ...current[index] }]);
    loadAirportDetails(code);
  };

  // "+ Add stop": show the candidates for the next stop (Results tab; on a phone, open the sheet enough to see the list).
  const handleAddStopPrompt = () => {
    setActivePanelTab('results');
    setSheetState('half');
  };

  const handleFinishOneWay = () => {
    if (oneWaySlotOpen && oneWayFinish.canFinish) setOneWayFinished(true);
  };

  const handleRemoveOneWayStopsFrom = (index) => {
    setOneWayStops(effectiveStops.slice(0, index));
    setOneWayLegs((current) => current.slice(0, index + 1));
    setOneWayFinished(false);
  };

  const handleOneWayLegChange = (index, range) => {
    setOneWayLegs((current) => current.map((leg, i) => (i === index ? { min: range.min, max: range.max } : leg)));
  };

  const handleMapReset = () => {
    setOneWayStops([]);
    setOneWayLegs((current) => current.slice(0, 1));
    setOneWayFinished(false);
    setSelectedFirstLegCode('');
    setSelectedSecondLegCode('');
    setActiveLegInfo(null);
    setSummaryOpen(false);
  };

  const oneWayPanel = {
    legs: oneWayLegs,
    stops: effectiveStops,
    route: oneWayRoute,
    homeCode: selectedAirportCode,
    destCode,
    destAirport,
    countries,
    homeAirport: selectedAirportWithCode,
    slotOpen: oneWaySlotOpen,
    activeIndex: oneWayActiveIndex,
    destRange,
    destCandidateCount: destCandidates.length,
    onDestRangeChange: handleDestRangeChange,
    onClearDest: () => setDestCode(''),
    onLegChange: handleOneWayLegChange,
    onClearFrom: handleRemoveOneWayStopsFrom,
    problem: oneWayProblem,
    finishInfo: oneWayFinish,
    finished: oneWayDone,
    onFinish: handleFinishOneWay,
    onAddStop: handleAddStopPrompt,
  };

  const oneWayResults = {
    active: isOneWay,
    candidates: oneWayCandidates,
    activeIndex: oneWayActiveIndex,
    slotOpen: oneWaySlotOpen,
    originCode: oneWayOriginCode,
    destCode,
    legs: oneWayLegs,
    route: oneWayRoute,
    onSelectStop: handleSelectOneWayStop,
    destPicking,
    destCandidates,
    destRange,
    onSelectDest: handleSelectDestination,
    problem: oneWayProblem,
    finishInfo: oneWayFinish,
    finished: oneWayDone,
    onFinish: handleFinishOneWay,
  };

  const titleBlock = (
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
        <img className="title-mark title-emblem" src={`${import.meta.env.BASE_URL}solo-emblem-64.png`} alt="Solo Aviators" width="32" height="32" />
        <span className="title-text">Cross Country Flight Planner</span>
      </h1>
      <a className="subtle-line home-link" href="https://www.soloaviators.com/">← Solo Aviators</a>
      <div className="subtle-line">App version: {APP_VERSION}</div>
      {visitors != null && <div className="subtle-line">Visitors (last 24h): {visitors.toLocaleString('en-US')}</div>}
      <div className="subtle-line" title={`FAA 28-Day NASR Subscription: Effective ${formatNasrEffective(databaseVersion)}`}>FAA NASR: {formatNasrEffectiveShort(databaseVersion)}</div>
    </div>
  );

  const mobileTitleBlock = (
    <div className="title-block mobile-title-card">
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
        <img className="title-mark title-emblem" src={`${import.meta.env.BASE_URL}solo-emblem-64.png`} alt="Solo Aviators" width="32" height="32" />
        <span className="title-text mobile-title-text">
          <span>Cross Country</span>
          <span>Flight Planner</span>
        </span>
      </h1>
      <a className="subtle-line home-link" href="https://www.soloaviators.com/">← Solo Aviators</a>
      <div className="subtle-line">App version: {APP_VERSION}</div>
      {visitors != null && <div className="subtle-line">Visitors (last 24h): {visitors.toLocaleString('en-US')}</div>}
      <div className="subtle-line" title={`FAA 28-Day NASR Subscription: Effective ${formatNasrEffective(databaseVersion)}`}>FAA NASR: {formatNasrEffectiveShort(databaseVersion)}</div>
    </div>
  );

  const tabsBlock = (
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
  );

  const panelFooter = (
    <div className="footer-actions">
      <button
        type="button"
        className="primary-btn"
        disabled={!summaryReady}
        onClick={() => setSummaryOpen(true)}
      >
        Summary Report
      </button>
    </div>
  );

  const desktopPanel = (
    <>
      {titleBlock}
      {tabsBlock}
      {activePanelTab === 'home' && (
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
      )}
      {activePanelTab === 'plan' && (
        <YourTripSection
          filters={filters}
          setFilters={setFilters}
          onMapReset={handleMapReset}
          hasMapSelection={Boolean(selectedFirstLegCode || selectedSecondLegCode || effectiveStops.length)}
          oneWay={oneWayPanel}
        />
      )}
      {activePanelTab === 'filters' && <FiltersSection filters={filters} setFilters={setFilters} />}
      {activePanelTab === 'results' && (
        <ResultsSection
          airportData={airportData}
          oneWay={oneWayResults}
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
      {tabsBlock}
      {panelFooter}
      {activePanelTab === 'home' && (
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
      )}
      {activePanelTab === 'plan' && (
        <YourTripSection
          filters={filters}
          setFilters={setFilters}
          onMapReset={handleMapReset}
          hasMapSelection={Boolean(selectedFirstLegCode || selectedSecondLegCode || effectiveStops.length)}
          oneWay={oneWayPanel}
        />
      )}
      {activePanelTab === 'filters' && <FiltersSection filters={filters} setFilters={setFilters} />}
      {activePanelTab === 'results' && (
        <ResultsSection
          airportData={airportData}
          oneWay={oneWayResults}
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
        <div className="mobile-map-title">
          {mobileTitleBlock}
        </div>
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
          onClearSelections={handleMapReset}
          onOpenSummary={() => setSummaryOpen(true)}
          airportData={airportData}
          onRequestAirportDetails={loadAirportDetails}
          oneWay={{
            active: isOneWay,
            destAirport,
            stops: effectiveStops,
            legs: oneWayLegs,
            candidates: oneWayCandidates,
            slotOpen: oneWaySlotOpen,
            activeIndex: oneWayActiveIndex,
            originCode: oneWayOriginCode,
            route: oneWayRoute,
            onSelectStop: handleSelectOneWayStop,
            destPicking,
            destCandidates,
            destRange,
            onSelectDest: handleSelectDestination,
            problem: oneWayProblem,
            finishInfo: oneWayFinish,
            finished: oneWayDone,
            onFinish: handleFinishOneWay,
          }}
        />
      </main>

      <div className="mobile-only">
        <BottomSheet
          state={sheetState}
          setState={setSheetState}
          hasSummaryAction={summaryReady}
        >
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
        oneWayCodes={oneWayCodes}
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
              <div>FAA 28-Day NASR Subscription: Effective {formatNasrEffective(databaseVersion)}</div>
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
