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
import { computeEllipsePoints, formatSurface, getAirspaceColor, haversine } from '../utils/geo';

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

function squareDivIcon(color, isSelected = false) {
  const size = isSelected ? 18 : 16;
  return L.divIcon({
    className: 'square-marker-wrapper',
    html: `<div class="square-marker ${isSelected ? 'selected' : ''}" style="background:${color};width:${size}px;height:${size}px"></div>`,
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

function renderAirportPopupContent(airport, extraLines = []) {
  const approaches = Array.isArray(airport.approaches) ? airport.approaches : [];
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
}) {
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
            <div className="airspace-legend-row muted">
              <span className="airspace-legend-swatch outer-sample" />
              <span>Filtered out / Max + 100 NM</span>
            </div>
          </>
        )}
      </div>

      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MapAutoView
        homeAirport={homeAirport}
      />
      <MapBackgroundReset
        enabled={Boolean(selectedFirstLegCode || selectedSecondLegCode)}
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
            pathOptions={{
              color,
              fillColor: color,
              fillOpacity: 0.16,
              opacity: 0.34,
              weight: 1.25,
            }}
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
            pathOptions={{
              color,
              fillColor: color,
              fillOpacity: 0.22,
              opacity: 0.45,
              weight: 1.5,
            }}
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
                `Distance: ${visibleInfoPopup.distance.toFixed(1)} NM`,
                `Total: ${(visibleInfoPopup.distance * 2).toFixed(1)} NM`,
              ])
            : renderAirportPopupContent(visibleInfoAirport, [
                `1st Leg: ${firstLegDistance?.toFixed(1) || '0.0'} NM`,
                `2nd Leg: ${visibleInfoPopup.leg2Distance.toFixed(1)} NM`,
                `Return: ${visibleInfoPopup.leg3Distance.toFixed(1)} NM`,
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
            pathOptions={{
              color,
              fillColor: color,
              fillOpacity: selected ? 0.98 : 0.88,
              weight: selected ? 3 : 2,
            }}
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
            icon={squareDivIcon(getAirspaceColor(airport.airspace), selected)}
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
    </MapContainer>
  );
}
