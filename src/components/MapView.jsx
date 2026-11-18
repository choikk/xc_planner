import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Pane,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import { computeEllipsePoints, formatCourse, formatSurface, getAirspaceColor, haversine, legCourse } from '../utils/geo';
import { formatDecommissionedNote } from '../utils/decommissioned';
import { useAopaDiagramUrl } from '../utils/aopa';
import VfrChartsControl from './VfrChartsControl';

const homeIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  shadowSize: [41, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -24],
});

const airspaceLegendItems = [
  ['B', 'Class B'],
  ['C', 'Class C'],
  ['D', 'Class D'],
  ['E', 'Class E'],
  ['G', 'Class G'],
];

// Private and military airports are drawn hollow (white inside, coloured outline); public ones are filled.
function isNonPublic(airport) {
  return Boolean(airport?.access) && airport.access !== 'pub';
}

function withAccessStyle(airport, options) {
  if (!isNonPublic(airport)) return options;
  return {
    ...options,
    fillColor: '#ffffff',
    fillOpacity: 0.92,
    weight: (options.weight || 1.5) + 1,
  };
}

function accessLabel(airport) {
  if (airport?.access === 'mil') return 'Military airport (private use)';
  if (airport?.access === 'pvt') return 'Private airport';
  return 'Public airport';
}

function squareDivIcon(color, isSelected = false, hollow = false) {
  const size = isSelected ? 18 : 16;
  const paint = hollow
    ? `background:#ffffff;border:3px solid ${color};box-sizing:border-box;`
    : `background:${color};`;
  return L.divIcon({
    className: 'square-marker-wrapper',
    html: `<div class="square-marker ${isSelected ? 'selected' : ''}" style="${paint}width:${size}px;height:${size}px"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char];
  });
}

function legInfoDivIcon(code) {
  const safeCode = escapeHtml(code);

  return L.divIcon({
    className: 'leg-info-marker-wrapper',
    html: `<div class="leg-info-marker"><strong>${safeCode}</strong><span>Leg Info</span></div>`,
    iconSize: [96, 34],
    iconAnchor: [0, 17],
  });
}

function destinationDivIcon() {
  return L.divIcon({
    className: 'oneway-marker-wrapper',
    html: '<div class="oneway-marker oneway-marker-b">B</div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function stopNumberDivIcon(number) {
  return L.divIcon({
    className: 'oneway-marker-wrapper',
    html: `<div class="oneway-marker oneway-marker-stop">${number}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Distance on the first line, magnetic course on the second: green for 000-179 (eastbound), red for 180-359 (westbound).
function legLabelDivIcon(text, magneticCourse) {
  const course = Number.isFinite(magneticCourse) ? Math.round(magneticCourse) % 360 : null;
  const courseLine = course === null
    ? ''
    : `<div class="oneway-leg-mc ${course < 180 ? 'mc-east' : 'mc-west'}">MC ${escapeHtml(formatCourse(magneticCourse))}\u00B0</div>`;
  return L.divIcon({
    className: 'oneway-leg-label-wrapper',
    html: `<div class="oneway-leg-label"><div>${escapeHtml(text)}</div>${courseLine}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

// " · MC 226°" for a leg between two airports (magnetic course at the middle of the leg), or '' when unknown.
function mcSuffix(from, to) {
  if (!from || !to || !isFiniteCoord(from.lat, from.lon) || !isFiniteCoord(to.lat, to.lon)) return '';
  const { magnetic } = legCourse(from.lat, from.lon, to.lat, to.lon);
  return Number.isFinite(magnetic) ? ` · MC ${formatCourse(magnetic)}\u00B0` : '';
}

function isFiniteCoord(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function stopLeafletEvent(event) {
  if (event?.originalEvent) {
    L.DomEvent.stop(event.originalEvent);
  }
}

function MapAutoView({ homeAirport }) {
  const map = useMap();
  const homeCode = homeAirport?.airport_code || '';

  useEffect(() => {
    if (!homeAirport || !isFiniteCoord(homeAirport.lat, homeAirport.lon)) return;

    map.setView([homeAirport.lat, homeAirport.lon], 7);
  }, [map, homeCode, homeAirport?.lat, homeAirport?.lon]);

  return null;
}

function MapFitRoute({ homeAirport, destAirport }) {
  const map = useMap();
  const homeCode = homeAirport?.airport_code || '';
  const destCode = destAirport?.airport_code || '';

  useEffect(() => {
    if (!homeAirport || !destAirport) return;
    if (!isFiniteCoord(homeAirport.lat, homeAirport.lon) || !isFiniteCoord(destAirport.lat, destAirport.lon)) return;
    map.fitBounds(
      [
        [homeAirport.lat, homeAirport.lon],
        [destAirport.lat, destAirport.lon],
      ],
      { padding: [60, 60], maxZoom: 9 }
    );
  }, [map, homeCode, destCode]);

  return null;
}

function MapFitRange({ homeAirport, maxNm }) {
  const map = useMap();
  const homeCode = homeAirport?.airport_code || '';

  useEffect(() => {
    if (!homeAirport || !isFiniteCoord(homeAirport.lat, homeAirport.lon) || !(maxNm > 0)) return;
    map.fitBounds(L.latLng(homeAirport.lat, homeAirport.lon).toBounds(maxNm * 1852 * 2), { padding: [20, 20] });
  }, [map, homeCode, maxNm]);

  return null;
}

function MapBackgroundReset({ enabled, onBackgroundClick, suppressResetRef }) {
  useMapEvents({
    click() {
      if (suppressResetRef?.current) {
        suppressResetRef.current = false;
        return;
      }
      if (!enabled) return;
      onBackgroundClick?.();
    },
  });

  return null;
}

// FAA airport diagram (PDF) when there is one; otherwise the AOPA diagram image when AOPA has it.
function AirportDiagramBlock({ airport }) {
  const faaUrl = airport.diagram?.pdf_url || '';
  const aopa = useAopaDiagramUrl(airport, !faaUrl);

  if (faaUrl) {
    return (
      <ul className="popup-list">
        <li>
          <a href={faaUrl} target="_blank" rel="noreferrer">
            Airport Diagram
          </a>
        </li>
      </ul>
    );
  }
  if (aopa === 'checking') return <div>Checking AOPA…</div>;
  if (aopa) {
    return (
      <ul className="popup-list">
        <li>
          <a href={aopa} target="_blank" rel="noreferrer">
            Airport Diagram (AOPA)
          </a>
        </li>
      </ul>
    );
  }
  return <div>None</div>;
}

function renderAirportPopupContent(airport, extraLines = []) {
  const approaches = Array.isArray(airport.approaches) ? airport.approaches : [];
  const decommissionedNote = formatDecommissionedNote(airport);
  const runways = Array.isArray(airport.runways) ? airport.runways : [];
  const fboContacts = Array.isArray(airport.fbo_contacts)
    ? airport.fbo_contacts.filter((contact) => contact?.name || contact?.phone)
    : [];
  const detailsLoaded = Boolean(airport.detailsLoaded);

  return (
    <div className="airport-popup">
      <div>
        <strong>{airport.airport_code}</strong> (Elevation {airport.elevation}ft, Class {airport.airspace})
      </div>
      <div>{airport.airport_name}</div>
      <div>{accessLabel(airport)}</div>
      <div>Fuel: {airport.fuel}</div>
      {fboContacts.map((contact, index) => (
        <div key={`${airport.airport_code}-fbo-${index}`}>
          FBO{fboContacts.length > 1 ? ` ${index + 1}` : ''}: {contact.name}
          {' '}(Ph. {contact.phone || ''})
        </div>
      ))}
      {extraLines.map((line, idx) => (
        <div key={idx}>{line}</div>
      ))}

      {detailsLoaded ? (
        <>
          <div className="popup-section-title">Runways:</div>
          {runways.length > 0 ? (
            <ul className="popup-list">
              {runways.map((rwy) => (
                <li key={`${airport.airport_code}-${rwy.rwy_id}`}>
                  {rwy.rwy_id}: {rwy.length}' × {rwy.width}' {formatSurface(rwy.surface)} ({rwy.condition})
                </li>
              ))}
            </ul>
          ) : (
            <div>None</div>
          )}

          <div className="popup-section-title">Airport Diagram:</div>
          <AirportDiagramBlock airport={airport} />

          <div className="popup-section-title">Instrument Approaches:</div>
          {approaches.length > 0 ? (
            <ul className="popup-list">
              {approaches.map((ap) => (
                <li key={`${airport.airport_code}-${ap.name}`}>
                  {ap.pdf_url ? (
                    <a href={ap.pdf_url} target="_blank" rel="noreferrer">
                      {ap.name}
                    </a>
                  ) : (
                    ap.name
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div>None</div>
          )}
          {decommissionedNote ? <div className="popup-note">{decommissionedNote}</div> : null}
        </>
      ) : (
        <div className="popup-section-title">Loading airport details...</div>
      )}
    </div>
  );
}

function PopupSummaryButton({ onClick }) {
  if (!onClick) return null;

  return (
    <button type="button" className="popup-summary-btn" onClick={onClick}>
      Summary Report
    </button>
  );
}

export default function MapView({
  homeAirport,
  filters,
  firstLegResults = [],
  filteredInRangeResults = [],
  nearbyOuterResults = [],
  secondLegResults = [],
  selectedFirstLegCode,
  selectedSecondLegCode,
  activeLegInfo,
  onSelectFirstLeg,
  onSelectSecondLeg,
  onClearSelections,
  onOpenSummary,
  airportData,
  onRequestAirportDetails,
  oneWay = null,
}) {
  const oneWayActive = Boolean(oneWay?.active);
  const oneWayDest = oneWayActive ? oneWay.destAirport : null;
  const oneWayStopAirports = oneWayActive
    ? oneWay.stops
        .map((code) => ({ code, airport: airportData[code] }))
        .filter(({ airport }) => airport && isFiniteCoord(airport.lat, airport.lon))
    : [];
  const oneWayOrigin = oneWayActive && oneWay.slotOpen ? airportData[oneWay.originCode] : null;
  const oneWayLeg = oneWayActive && oneWay.slotOpen ? oneWay.legs[oneWay.activeIndex] : null;
  const oneWayPath = [];
  if (oneWayActive && homeAirport && isFiniteCoord(homeAirport.lat, homeAirport.lon)) {
    oneWayPath.push({ code: homeAirport.airport_code, lat: homeAirport.lat, lon: homeAirport.lon });
    oneWayStopAirports.forEach(({ code, airport }) => oneWayPath.push({ code, lat: airport.lat, lon: airport.lon }));
  }
  const oneWayDestPoint =
    oneWayDest && isFiniteCoord(oneWayDest.lat, oneWayDest.lon)
      ? { code: oneWayDest.airport_code, lat: oneWayDest.lat, lon: oneWayDest.lon }
      : null;
  const oneWayRouteComplete = Boolean(oneWayActive && oneWay.route?.complete);
  const oneWaySolidPath = oneWayRouteComplete && oneWayDestPoint ? [...oneWayPath, oneWayDestPoint] : oneWayPath;
  const [infoPopup, setInfoPopup] = useState(null);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [touchMode, setTouchMode] = useState(false);
  const suppressBackgroundResetRef = useRef(false);

  const homeCenter = useMemo(() => {
    if (homeAirport && isFiniteCoord(homeAirport.lat, homeAirport.lon)) {
      return [homeAirport.lat, homeAirport.lon];
    }
    return [39.8283, -98.5795];
  }, [homeAirport?.airport_code, homeAirport?.lat, homeAirport?.lon]);

  const minMeters = filters.firstLegMin * 1852;
  const maxMeters = filters.firstLegMax * 1852;

  const firstSelectedAirport = selectedFirstLegCode ? airportData[selectedFirstLegCode] || null : null;
  const secondSelectedAirport = selectedSecondLegCode ? airportData[selectedSecondLegCode] || null : null;

  const firstLegDistance =
    homeAirport &&
    firstSelectedAirport &&
    isFiniteCoord(homeAirport.lat, homeAirport.lon) &&
    isFiniteCoord(firstSelectedAirport.lat, firstSelectedAirport.lon)
      ? haversine(homeAirport.lat, homeAirport.lon, firstSelectedAirport.lat, firstSelectedAirport.lon)
      : null;
  const visibleInfoPopup =
    infoPopup?.type === 'first'
      ? firstLegResults.find((result) => result.code === infoPopup.code)
      : infoPopup?.type === 'second'
        ? secondLegResults.find((result) => result.code === infoPopup.code)
        : null;
  const visibleInfoAirport = visibleInfoPopup ? airportData[visibleInfoPopup.code] : null;
  const visibleInfoPosition =
    visibleInfoAirport && isFiniteCoord(visibleInfoAirport.lat, visibleInfoAirport.lon)
      ? [visibleInfoAirport.lat, visibleInfoAirport.lon]
      : null;

  useEffect(() => {
    setInfoPopup(null);
  }, [homeAirport?.airport_code, filters, selectedFirstLegCode, selectedSecondLegCode]);

  useEffect(() => {
    if (visibleInfoPopup?.code) {
      onRequestAirportDetails?.(visibleInfoPopup.code);
    }
  }, [visibleInfoPopup?.code, onRequestAirportDetails]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const media = window.matchMedia('(max-width: 560px)');
    const update = () => setLegendCollapsed(media.matches);
    update();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const media = window.matchMedia('(hover: none), (pointer: coarse)');
    const update = () => setTouchMode(media.matches || window.navigator.maxTouchPoints > 0);
    update();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  const triangleLine =
    homeAirport &&
    firstSelectedAirport &&
    secondSelectedAirport &&
    isFiniteCoord(homeAirport.lat, homeAirport.lon) &&
    isFiniteCoord(firstSelectedAirport.lat, firstSelectedAirport.lon) &&
    isFiniteCoord(secondSelectedAirport.lat, secondSelectedAirport.lon)
      ? [
          [homeAirport.lat, homeAirport.lon],
          [firstSelectedAirport.lat, firstSelectedAirport.lon],
          [secondSelectedAirport.lat, secondSelectedAirport.lon],
          [homeAirport.lat, homeAirport.lon],
        ]
      : null;

  const firstLegLine =
    homeAirport &&
    firstSelectedAirport &&
    isFiniteCoord(homeAirport.lat, homeAirport.lon) &&
    isFiniteCoord(firstSelectedAirport.lat, firstSelectedAirport.lon)
      ? [
          [homeAirport.lat, homeAirport.lon],
          [firstSelectedAirport.lat, firstSelectedAirport.lon],
        ]
      : null;

  const outerEllipse = useMemo(() => {
    if (
      !homeAirport ||
      !firstSelectedAirport ||
      filters.tripType !== 'two' ||
      firstLegDistance === null
    ) {
      return [];
    }

    const semiMajor = (filters.totalLegMax - firstLegDistance) / 2;
    if (semiMajor < 0) return [];

    return computeEllipsePoints(
      [homeAirport.lat, homeAirport.lon],
      [firstSelectedAirport.lat, firstSelectedAirport.lon],
      semiMajor
    );
  }, [
    homeAirport,
    firstSelectedAirport,
    filters.tripType,
    filters.totalLegMax,
    firstLegDistance,
  ]);

  const markMapInteraction = (event) => {
    suppressBackgroundResetRef.current = true;
    stopLeafletEvent(event);
  };
  const showHoverTooltips = !touchMode;

  const innerEllipse = useMemo(() => {
    if (
      !homeAirport ||
      !firstSelectedAirport ||
      filters.tripType !== 'two' ||
      firstLegDistance === null
    ) {
      return [];
    }

    const semiMajor = (filters.totalLegMin - firstLegDistance) / 2;
    if (semiMajor < 0) return [];

    return computeEllipsePoints(
      [homeAirport.lat, homeAirport.lon],
      [firstSelectedAirport.lat, firstSelectedAirport.lon],
      semiMajor
    );
  }, [
    homeAirport,
    firstSelectedAirport,
    filters.tripType,
    filters.totalLegMin,
    firstLegDistance,
  ]);

  return (
    <MapContainer center={homeCenter} zoom={7} className="map-canvas" zoomControl>
      <div className={`airspace-legend ${legendCollapsed ? 'collapsed' : ''}`}>
        <div className="airspace-legend-header">
          <strong>Airspace Classes</strong>
          <button
            type="button"
            className="airspace-legend-toggle"
            onClick={() => setLegendCollapsed((current) => !current)}
          >
            {legendCollapsed ? 'Show' : 'Hide'}
          </button>
        </div>
        {!legendCollapsed && (
          <>
            {airspaceLegendItems.map(([classCode, label]) => (
              <div key={classCode} className="airspace-legend-row">
                <span className="airspace-legend-swatch" style={{ background: getAirspaceColor(classCode) }} />
                <span>{label}</span>
              </div>
            ))}
            <div className="airspace-legend-row">
              <span className="airspace-legend-swatch access-public" />
              <span>Public airport</span>
            </div>
            <div className="airspace-legend-row">
              <span className="airspace-legend-swatch access-nonpublic" />
              <span>Private / military airport</span>
            </div>
            <div className="airspace-legend-row muted">
              <span className="airspace-legend-swatch outer-sample" />
              <span>Filtered out / Max + 100 NM</span>
            </div>
            {oneWayActive && (
              <>
                <div className="airspace-legend-row">
                  <span className="airspace-legend-swatch mc-east-swatch" />
                  <span>MC 000–179°: odd thousands (+500ft for VFR)</span>
                </div>
                <div className="airspace-legend-row">
                  <span className="airspace-legend-swatch mc-west-swatch" />
                  <span>MC 180–359°: even thousands (+500ft for VFR)</span>
                </div>
                <div className="airspace-legend-row muted">
                  <span className="airspace-legend-swatch" style={{ background: 'transparent', border: 'none' }} />
                  <span>Cruising altitude: IFR 14 CFR 91.179, VFR 14 CFR 91.159</span>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {oneWayActive && oneWay.slotOpen && oneWay.candidates.length === 0 && !oneWay.finishInfo?.canFinish && (
        <div className="oneway-map-note">
          {oneWay.problem || 'No airports match this leg. Widen the leg limits or relax the filters.'}
        </div>
      )}

      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <VfrChartsControl position="topright" />

      {oneWayActive && oneWayDest ? (
        <MapFitRoute homeAirport={homeAirport} destAirport={oneWayDest} />
      ) : oneWayActive && oneWay.destPicking ? (
        <MapFitRange homeAirport={homeAirport} maxNm={oneWay.destRange.max} />
      ) : (
        <MapAutoView
          homeAirport={homeAirport}
        />
      )}
      <MapBackgroundReset
        enabled={Boolean(selectedFirstLegCode || selectedSecondLegCode) && !oneWayActive}
        onBackgroundClick={onClearSelections}
        suppressResetRef={suppressBackgroundResetRef}
      />

      <Pane name="ellipsePane" style={{ zIndex: 250 }} />

      {homeAirport && isFiniteCoord(homeAirport.lat, homeAirport.lon) && (
        <>
          <Marker
            position={homeCenter}
            icon={homeIcon}
            eventHandlers={{
              click: markMapInteraction,
            }}
          >
            <Popup>
              <strong>{homeAirport.airport_code}</strong>
              <br />
              {homeAirport.airport_name}
            </Popup>
          </Marker>

          {!oneWayActive && (
            <>
              <Circle
                center={homeCenter}
                radius={minMeters}
                pathOptions={{ color: 'green', dashArray: '6 6', fill: false }}
              />
              <Circle
                center={homeCenter}
                radius={maxMeters}
                pathOptions={{ color: 'red', dashArray: '6 6', fill: false }}
              />
            </>
          )}
        </>
      )}

      {nearbyOuterResults.map((result) => {
        const airport = airportData[result.code];
        if (!airport) return null;
        if (!isFiniteCoord(airport.lat, airport.lon)) return null;

        const color = getAirspaceColor(airport.airspace);

        return (
          <CircleMarker
            key={`outer-${result.code}`}
            center={[airport.lat, airport.lon]}
            radius={5}
            eventHandlers={{
              click: markMapInteraction,
              popupopen: () => onRequestAirportDetails?.(result.code),
            }}
            pathOptions={withAccessStyle(airport, {
              color,
              fillColor: color,
              fillOpacity: 0.16,
              opacity: 0.34,
              weight: 1.25,
            })}
          >
            {showHoverTooltips && (
              <Tooltip direction="top" offset={[0, -8]}>
                {result.code}
              </Tooltip>
            )}
            <Popup minWidth={290} maxWidth={480}>
              {renderAirportPopupContent(airport, [
                `Distance: ${result.distance.toFixed(1)} NM`,
                `Outside max by: ${(result.distance - filters.firstLegMax).toFixed(1)} NM`,
              ])}
            </Popup>
          </CircleMarker>
        );
      })}

      {filteredInRangeResults.map((result) => {
        const airport = airportData[result.code];
        if (!airport) return null;
        if (!isFiniteCoord(airport.lat, airport.lon)) return null;

        const color = getAirspaceColor(airport.airspace);

        return (
          <CircleMarker
            key={`filtered-${result.code}`}
            center={[airport.lat, airport.lon]}
            radius={5}
            eventHandlers={{
              click: markMapInteraction,
              popupopen: () => onRequestAirportDetails?.(result.code),
            }}
            pathOptions={withAccessStyle(airport, {
              color,
              fillColor: color,
              fillOpacity: 0.22,
              opacity: 0.45,
              weight: 1.5,
            })}
          >
            {showHoverTooltips && (
              <Tooltip direction="top" offset={[0, -8]}>
                {result.code}
              </Tooltip>
            )}
            <Popup minWidth={290} maxWidth={480}>
              {renderAirportPopupContent(airport, [
                `Distance: ${result.distance.toFixed(1)} NM`,
                'Excluded by current filters',
                'Not selectable as a destination',
              ])}
            </Popup>
          </CircleMarker>
        );
      })}

      {filters.tripType === 'two' && outerEllipse.length > 0 && (
        <Polygon
          positions={outerEllipse}
          pane="ellipsePane"
          pathOptions={{ color: '#FFA500', dashArray: '5 5', fillOpacity: 0.05 }}
        />
      )}

      {filters.tripType === 'two' && innerEllipse.length > 0 && (
        <Polygon
          positions={innerEllipse}
          pane="ellipsePane"
          pathOptions={{ color: '#32CD32', dashArray: '2 6', fillOpacity: 0.05 }}
        />
      )}

      {firstLegLine && !triangleLine && (
        <Polyline positions={firstLegLine} pathOptions={{ color: '#FF00FF', weight: 4 }} />
      )}
      {triangleLine && (
        <Polyline positions={triangleLine} pathOptions={{ color: '#FF00FF', weight: 4 }} />
      )}

      {visibleInfoPopup && visibleInfoAirport && visibleInfoPosition && (
        <Popup
          position={visibleInfoPosition}
          minWidth={290}
          maxWidth={480}
          eventHandlers={{
            remove: () => setInfoPopup(null),
          }}
        >
          {infoPopup.type === 'first'
            ? renderAirportPopupContent(visibleInfoAirport, [
                `Distance: ${visibleInfoPopup.distance.toFixed(1)} NM${mcSuffix(homeAirport, visibleInfoAirport)}`,
                `Return: ${visibleInfoPopup.distance.toFixed(1)} NM${mcSuffix(visibleInfoAirport, homeAirport)}`,
                `Total: ${(visibleInfoPopup.distance * 2).toFixed(1)} NM`,
              ])
            : renderAirportPopupContent(visibleInfoAirport, [
                `1st Leg: ${firstLegDistance?.toFixed(1) || '0.0'} NM${mcSuffix(homeAirport, firstSelectedAirport)}`,
                `2nd Leg: ${visibleInfoPopup.leg2Distance.toFixed(1)} NM${mcSuffix(firstSelectedAirport, visibleInfoAirport)}`,
                `Return: ${visibleInfoPopup.leg3Distance.toFixed(1)} NM${mcSuffix(visibleInfoAirport, homeAirport)}`,
                `Total: ${visibleInfoPopup.totalDistance.toFixed(1)} NM`,
              ])}
          <PopupSummaryButton
            onClick={() => {
              if (infoPopup.type === 'first') {
                onSelectFirstLeg(visibleInfoPopup.code);
              } else {
                onSelectSecondLeg(visibleInfoPopup.code);
              }
              onOpenSummary?.();
            }}
          />
        </Popup>
      )}

      {firstLegResults.map((result) => {
        const airport = airportData[result.code];
        if (!airport) return null;
        if (!isFiniteCoord(airport.lat, airport.lon)) return null;

        const selected = selectedFirstLegCode === result.code;
        const color = getAirspaceColor(airport.airspace);
        const handleFirstLegSelect = (event) => {
          markMapInteraction(event);
          setInfoPopup(null);
          onSelectFirstLeg(result.code);
        };

        return (
          <CircleMarker
            key={`first-${result.code}`}
            center={[airport.lat, airport.lon]}
            radius={selected ? 9 : 7}
            eventHandlers={{
              click: handleFirstLegSelect,
              touchstart: handleFirstLegSelect,
            }}
            pathOptions={withAccessStyle(airport, {
              color,
              fillColor: color,
              fillOpacity: selected ? 0.98 : 0.88,
              weight: selected ? 3 : 2,
            })}
          >
            {showHoverTooltips && (
              <Tooltip direction="top" offset={[0, -8]}>
                {result.code}
              </Tooltip>
            )}
          </CircleMarker>
        );
      })}

      {secondLegResults.map((result) => {
        const airport = airportData[result.code];
        if (!airport) return null;
        if (!isFiniteCoord(airport.lat, airport.lon)) return null;

        const selected = selectedSecondLegCode === result.code;
        const handleSecondLegSelect = (event) => {
          markMapInteraction(event);
          setInfoPopup(null);
          onSelectSecondLeg(result.code);
        };

        return (
          <Marker
            key={`second-${result.code}`}
            position={[airport.lat, airport.lon]}
            icon={squareDivIcon(getAirspaceColor(airport.airspace), selected, isNonPublic(airport))}
            eventHandlers={{
              click: handleSecondLegSelect,
              touchstart: handleSecondLegSelect,
            }}
          >
            {showHoverTooltips && (
              <Tooltip direction="top" offset={[0, -8]}>
                {result.code}
              </Tooltip>
            )}
          </Marker>
        );
      })}

      {activeLegInfo?.type === 'first' &&
        firstSelectedAirport &&
        activeLegInfo.code === selectedFirstLegCode &&
        isFiniteCoord(firstSelectedAirport.lat, firstSelectedAirport.lon) && (
        <Marker
          position={[firstSelectedAirport.lat, firstSelectedAirport.lon]}
          icon={legInfoDivIcon(selectedFirstLegCode)}
          zIndexOffset={1000}
          eventHandlers={{
            click: (event) => {
              markMapInteraction(event);
              setInfoPopup({ type: 'first', code: selectedFirstLegCode });
            },
          }}
        />
      )}

      {activeLegInfo?.type === 'second' &&
        secondSelectedAirport &&
        activeLegInfo.code === selectedSecondLegCode &&
        isFiniteCoord(secondSelectedAirport.lat, secondSelectedAirport.lon) && (
        <Marker
          position={[secondSelectedAirport.lat, secondSelectedAirport.lon]}
          icon={legInfoDivIcon(selectedSecondLegCode)}
          zIndexOffset={1000}
          eventHandlers={{
            click: (event) => {
              markMapInteraction(event);
              setInfoPopup({ type: 'second', code: selectedSecondLegCode });
            },
          }}
        />
      )}

      {oneWayActive && (
        <>
          {oneWayOrigin && oneWayLeg && isFiniteCoord(oneWayOrigin.lat, oneWayOrigin.lon) && (
            <>
              <Circle
                center={[oneWayOrigin.lat, oneWayOrigin.lon]}
                radius={oneWayLeg.min * 1852}
                pathOptions={{ color: 'green', dashArray: '6 6', fill: false }}
              />
              <Circle
                center={[oneWayOrigin.lat, oneWayOrigin.lon]}
                radius={oneWayLeg.max * 1852}
                pathOptions={{ color: 'red', dashArray: '6 6', fill: false }}
              />
            </>
          )}

          {oneWay.destPicking && oneWay.destRange && homeAirport && isFiniteCoord(homeAirport.lat, homeAirport.lon) && (
            <>
              <Circle
                center={[homeAirport.lat, homeAirport.lon]}
                radius={oneWay.destRange.min * 1852}
                pathOptions={{ color: 'green', dashArray: '6 6', fill: false }}
              />
              <Circle
                center={[homeAirport.lat, homeAirport.lon]}
                radius={oneWay.destRange.max * 1852}
                pathOptions={{ color: 'red', dashArray: '6 6', fill: false }}
              />
            </>
          )}

          {[
            ...((oneWay.faint?.outer || []).map((result) => ({ ...result, kind: 'outer' }))),
            ...((oneWay.faint?.filtered || []).map((result) => ({ ...result, kind: 'filtered' }))),
          ].map((result) => {
            const airport = airportData[result.code];
            if (!airport || !isFiniteCoord(airport.lat, airport.lon)) return null;
            const color = getAirspaceColor(airport.airspace);
            const outer = result.kind === 'outer';

            return (
              <CircleMarker
                key={`oneway-${result.kind}-${result.code}`}
                center={[airport.lat, airport.lon]}
                radius={5}
                eventHandlers={{
                  click: markMapInteraction,
                  popupopen: () => onRequestAirportDetails?.(result.code),
                }}
                pathOptions={withAccessStyle(airport, {
                  color,
                  fillColor: color,
                  fillOpacity: outer ? 0.16 : 0.22,
                  opacity: outer ? 0.34 : 0.45,
                  weight: outer ? 1.25 : 1.5,
                })}
              >
                {showHoverTooltips && (
                  <Tooltip direction="top" offset={[0, -8]}>
                    {result.code}
                  </Tooltip>
                )}
                <Popup minWidth={290} maxWidth={480}>
                  {renderAirportPopupContent(airport, [
                    `Distance: ${result.distance.toFixed(1)} NM`,
                    outer ? 'Outside the maximum distance' : 'Excluded by current filters',
                    'Not selectable',
                  ])}
                </Popup>
              </CircleMarker>
            );
          })}

          {(oneWay.destCandidates || []).map((result) => {
            const airport = airportData[result.code];
            if (!airport || !isFiniteCoord(airport.lat, airport.lon)) return null;
            const color = getAirspaceColor(airport.airspace);

            return (
              <CircleMarker
                key={`oneway-dest-${result.code}`}
                center={[airport.lat, airport.lon]}
                radius={6}
                eventHandlers={{
                  click: markMapInteraction,
                  popupopen: () => onRequestAirportDetails?.(result.code),
                }}
                pathOptions={withAccessStyle(airport, {
                  color,
                  fillColor: color,
                  fillOpacity: 0.85,
                  weight: 2,
                })}
              >
                {showHoverTooltips && (
                  <Tooltip direction="top" offset={[0, -8]}>
                    {result.code} · {result.distance.toFixed(0)} NM
                  </Tooltip>
                )}
                <Popup minWidth={290} maxWidth={480}>
                  {renderAirportPopupContent(airport, [`Distance from ${homeAirport?.airport_code || 'A'}: ${result.distance.toFixed(1)} NM${mcSuffix(homeAirport, airport)}`])}
                  <button
                    type="button"
                    className="popup-summary-btn"
                    onClick={() => oneWay.onSelectDest(result.code)}
                  >
                    Set as Destination
                  </button>
                </Popup>
              </CircleMarker>
            );
          })}

          {oneWaySolidPath.length > 1 && (
            <Polyline
              positions={oneWaySolidPath.map((point) => [point.lat, point.lon])}
              pathOptions={{ color: '#FF00FF', weight: 4 }}
            />
          )}
          {!oneWayRouteComplete && oneWayDestPoint && oneWayPath.length > 0 && (
            <Polyline
              positions={[
                [oneWayPath[oneWayPath.length - 1].lat, oneWayPath[oneWayPath.length - 1].lon],
                [oneWayDestPoint.lat, oneWayDestPoint.lon],
              ]}
              pathOptions={{ color: '#475569', weight: 2, dashArray: '4 8' }}
            />
          )}

          {oneWaySolidPath.slice(1).map((point, index) => {
            const from = oneWaySolidPath[index];
            const distance = haversine(from.lat, from.lon, point.lat, point.lon);
            const { magnetic } = legCourse(from.lat, from.lon, point.lat, point.lon);
            return (
              <Marker
                key={`label-${from.code}-${point.code}`}
                position={[(from.lat + point.lat) / 2, (from.lon + point.lon) / 2]}
                icon={legLabelDivIcon(`${distance.toFixed(1)} NM`, magnetic)}
                interactive={false}
              />
            );
          })}

          {oneWayDestPoint && (
            <Marker
              position={[oneWayDestPoint.lat, oneWayDestPoint.lon]}
              icon={destinationDivIcon()}
              zIndexOffset={900}
              eventHandlers={{
                click: markMapInteraction,
                popupopen: () => onRequestAirportDetails?.(oneWayDestPoint.code),
              }}
            >
              <Popup minWidth={290} maxWidth={480}>
                {renderAirportPopupContent(oneWayDest, [
                  'Destination',
                  ...(oneWay.slotOpen && oneWay.finishInfo
                    ? [`From here: ${oneWay.finishInfo.distance.toFixed(1)} NM${mcSuffix(oneWayOrigin, oneWayDest)}`]
                    : []),
                ])}
                {oneWay.slotOpen && oneWay.finishInfo?.canFinish && (
                  <button type="button" className="popup-summary-btn" onClick={() => oneWay.onFinish()}>
                    Finish adding stops
                  </button>
                )}
              </Popup>
            </Marker>
          )}

          {oneWay.candidates.map((result) => {
            const airport = airportData[result.code];
            if (!airport || !isFiniteCoord(airport.lat, airport.lon)) return null;
            const color = getAirspaceColor(airport.airspace);

            return (
              <CircleMarker
                key={`oneway-cand-${result.code}`}
                center={[airport.lat, airport.lon]}
                radius={7}
                eventHandlers={{
                  click: markMapInteraction,
                  popupopen: () => onRequestAirportDetails?.(result.code),
                }}
                pathOptions={withAccessStyle(airport, {
                  color,
                  fillColor: color,
                  fillOpacity: 0.88,
                  weight: 2,
                })}
              >
                {showHoverTooltips && (
                  <Tooltip direction="top" offset={[0, -8]}>
                    {result.code} · {result.distance.toFixed(0)} NM
                  </Tooltip>
                )}
                <Popup minWidth={290} maxWidth={480}>
                  {renderAirportPopupContent(airport, [
                    `Leg ${oneWay.activeIndex + 1}: ${result.distance.toFixed(1)} NM${mcSuffix(oneWayOrigin, airport)}`,
                    `To ${oneWayDest?.airport_code || 'B'}: ${result.toDest.toFixed(1)} NM${result.closer ? '' : ' (farther than now)'}`,
                  ])}
                  <button
                    type="button"
                    className="popup-summary-btn"
                    onClick={() => oneWay.onSelectStop(result.code)}
                  >
                    Add as Stop {oneWay.activeIndex + 1}
                  </button>
                </Popup>
              </CircleMarker>
            );
          })}

          {oneWayStopAirports.map(({ code, airport }, index) => (
            <Marker
              key={`oneway-stop-${code}`}
              position={[airport.lat, airport.lon]}
              icon={stopNumberDivIcon(index + 1)}
              zIndexOffset={800}
              eventHandlers={{
                click: markMapInteraction,
                popupopen: () => onRequestAirportDetails?.(code),
              }}
            >
              <Popup minWidth={290} maxWidth={480}>
                {renderAirportPopupContent(airport, [`Stop ${index + 1}`])}
              </Popup>
            </Marker>
          ))}
        </>
      )}
    </MapContainer>
  );
}
