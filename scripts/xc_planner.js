let APP_VERSION = "v1.2.2"; // or whatever you like
let FILE_DATE = new Date(document.lastModified).toISOString().split("T")[0];
let DATABASE_VERSION = "20_MAR_2025"; // default fallback

let airportData = {};

let map, marker;
let minCircle, maxCircle;
let maskLayer, minLabel, maxLabel;

let destinationMarkers = [];
let triangleLines = [];
let secondLegMarkers = [];

let legLine;

let legendAdded = false;
let secondLegRing;

let secondLegEllipseInner = null;
let secondLegEllipseOuter = null;

let currentFirstLegDestinations = [];
let currentSecondLegDestinations = [];
let currentLeg = 'first'; // Tracks the current active leg ('first' or 'second')

const squareMarker = (color) => L.divIcon({
  className: "custom-square",
  iconSize: [12, 12],
  html: `<div style="
    width: 12px;
    height: 12px;
    background-color: ${color};
    border: 1px solid #333;
    box-sizing: border-box;
  "></div>`
});

const triangleMarker = (color) => L.divIcon({
  className: "custom-triangle",
  iconSize: [16, 16],
  html: `<div style="
    width: 0;
    height: 0;
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
    border-bottom: 14px solid ${color};
  "></div>`
});

async function loadDatabaseVersion() {
  try {
    const response = await fetch("json_data/db_versions.txt");
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);

    const text = await response.text();
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");
    if (lines.length > 0) {
      DATABASE_VERSION = lines[0];
      console.log("📦 DATABASE_VERSION loaded:", DATABASE_VERSION);
    }
  } catch (err) {
    console.error("❌ Failed to load DATABASE_VERSION:", err);
  }
}

async function loadData() {
  try {
    const response = await fetch("json_data/airport_base_info_with_runways_airspace.json");
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    airportData = await response.json();
  } catch (err) {
    console.error("❌ Failed to load airport data:", err);
    alert("Error loading airport data.");
    return;
  }

  const countries = new Set();
  const statesByCountry = {};
  const airportsByState = {};

  for (const code in airportData) {
    const airport = airportData[code];
    const country = airport.country || "Unknown";
    const state = airport.state || "Unknown";

    countries.add(country);
    if (!statesByCountry[country]) statesByCountry[country] = new Set();
    statesByCountry[country].add(state);

    const key = `${country}-${state}`;
    if (!airportsByState[key]) airportsByState[key] = [];
    airportsByState[key].push({ code, name: airport.airport_name });
  }

  populateSelect("countrySelect", [...countries].sort());
  document.getElementById("countrySelect").addEventListener("change", () => {
    const selectedCountry = document.getElementById("countrySelect").value;
    populateSelect("stateSelect", [...statesByCountry[selectedCountry]].sort());
    document.getElementById("airportSelect").innerHTML = "";
    document.getElementById("homeBaseInfo").innerHTML = "";
  });

  document.getElementById("stateSelect").addEventListener("change", () => {
    const key = `${document.getElementById("countrySelect").value}-${document.getElementById("stateSelect").value}`;
    const airports = airportsByState[key] || [];
    airports.sort((a, b) => a.code.localeCompare(b.code));
    populateSelect("airportSelect", airports.map(a => `${a.code} - ${a.name}`), airports.map(a => a.code));
    if (airports.length > 0) {
    // ✅ Select the first airport
      document.getElementById("airportSelect").value = airports[0].code;

    // ✅ Trigger change event to update info box and map
      document.getElementById("airportSelect").dispatchEvent(new Event("change"));
    }
  });

  document.getElementById("airportSelect").addEventListener("change", () => {
    const code = document.getElementById("airportSelect").value;
    const ap = airportData[code];
    if (!ap) return;
    document.getElementById("homeBaseInfo").innerHTML = `
      <strong>${code} - ${ap.airport_name}</strong><br>
      ${ap.city}, ${ap.state}, ${ap.country}<br>
      Airspace: ${ap.airspace}<br>
      <strong>Runways:</strong><br>
      ${ap.runways.map(r => `${r.rwy_id}: ${r.length} ft, ${r.surface}, ${r.condition}`).join("<br>")}
    `;
    updateMap(ap.lat, ap.lon, `${code} - ${ap.airport_name}`);
    resetTripState();
  });

  // Default selection
  document.getElementById("countrySelect").value = "US";
  document.getElementById("countrySelect").dispatchEvent(new Event("change"));

  setTimeout(() => {
    const state = document.getElementById("stateSelect");
    if (state.options.length > 0) {
      state.selectedIndex = 0;
      state.dispatchEvent(new Event("change"));
      setTimeout(() => {
        const airport = document.getElementById("airportSelect");
        if (airport.options.length > 0) {
          airport.selectedIndex = 0;
          airport.dispatchEvent(new Event("change"));
        }
      }, 50);
    }
  }, 50);
}

function initMap() {
  map = L.map("map").setView([39.8283, -98.5795], 6); // Centered on U.S.

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  // 🟦 Custom pane for ellipses behind everything
  map.createPane("ellipsePane");
  map.getPane("ellipsePane").style.zIndex = 299; // lower than default markers
}

function updateMap(lat, lon, label) {
  if (!map) return;

  map.setView([lat, lon], 8);

  if (marker) map.removeLayer(marker);
  marker = L.marker([lat, lon]).addTo(map).bindPopup(label).openPopup();

  refreshDistanceCircles(); // ← draw circles immediately
  addMapLegend();
}

function refreshDistanceCircles() {
  if (!map || !marker) return;

  const latlng = marker.getLatLng();
  const minNM = parseFloat(document.getElementById("firstLegMin").value);
  const maxNM = parseFloat(document.getElementById("firstLegMax").value);
  const minMeters = minNM * 1852;
  const maxMeters = maxNM * 1852;

  // Remove existing layers
  [minCircle, maxCircle, minLabel, maxLabel, maskLayer].forEach(layer => {
    if (layer) map.removeLayer(layer);
  });

  minCircle = L.circle(latlng, {
    radius: minMeters,
    color: "green",
    fill: false,
    weight: 3,
    dashArray: "6 6"
  }).addTo(map);

  maxCircle = L.circle(latlng, {
    radius: maxMeters,
    color: "red",
    fill: false,
    weight: 3,
    dashArray: "6 6"
  }).addTo(map);

  const latOffset1 = (minMeters / 1852) / 60;
  minLabel = L.marker([latlng.lat + latOffset1, latlng.lng], {
    icon: L.divIcon({
      className: 'circle-label',
      html: `<div style="color: green; font-size: 14px; font-weight: bold;">${minNM} NM</div>`,
      iconAnchor: [0, 0]
    })
  }).addTo(map);

  const latOffset2 = (maxMeters / 1852) / 60;
  maxLabel = L.marker([latlng.lat + latOffset2, latlng.lng], {
    icon: L.divIcon({
      className: 'circle-label',
      html: `<div style="color: red; font-size: 14px; font-weight: bold;">${maxNM} NM</div>`,
      iconAnchor: [0, 0]
    })
  }).addTo(map);
}

function populateSelect(id, items, values) {
  const sel = document.getElementById(id);
  sel.innerHTML = "";
  items.forEach((item, i) => {
    const opt = document.createElement("option");
    opt.value = values ? values[i] : item;
    opt.textContent = item;
    sel.appendChild(opt);
  });
}

function updateLabel(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function syncFirstLegInputsFromSlider() {
  const minSlider = document.getElementById("firstLegMin");
  const maxSlider = document.getElementById("firstLegMax");
  const minInput = document.getElementById("firstLegMinInput");
  const maxInput = document.getElementById("firstLegMaxInput");

  let min = parseInt(minSlider.value);
  let max = parseInt(maxSlider.value);

  // Enforce min/max bounds
  min = Math.max(10, Math.min(min, 500));
  max = Math.max(10, Math.min(max, 500));

  // Ensure min <= max
  if (min > max) {
    minSlider.value = max; // Adjust slider if needed
    min = max;
  }

  // Sync inputs
  minInput.value = min;
  maxInput.value = max;

  updateFirstLegLabel();
}

function syncFirstLegSlidersFromInput() {
  const minInput = document.getElementById("firstLegMinInput");
  const maxInput = document.getElementById("firstLegMaxInput");

  let min = parseInt(minInput.value);
  let max = parseInt(maxInput.value);

  if (isNaN(min)) min = 1;
  if (isNaN(max)) max = 1;

  min = Math.max(1, Math.min(min, 500));
  max = Math.max(1, Math.min(max, 500));

  if (min > max) {
    [min, max] = [max, min];
  }

  document.getElementById("firstLegMin").value = min;
  document.getElementById("firstLegMax").value = max;
  minInput.value = min;
  maxInput.value = max;

  updateFirstLegLabel();
}

function updateFirstLegLabel() {
   let minVal = parseInt(document.getElementById("firstLegMin").value);
   let maxVal = parseInt(document.getElementById("firstLegMax").value);

   if (minVal > maxVal) {
     [minVal, maxVal] = [maxVal, minVal];
     document.getElementById("firstLegMin").value = minVal;
     document.getElementById("firstLegMax").value = maxVal;
   }

//   document.getElementById("firstLegLabel").textContent = `${minVal} - ${maxVal} NM`;
}

function updateTotalLegLabel() {
  let min = parseInt(document.getElementById("totalLegMin").value);
  let max = parseInt(document.getElementById("totalLegMax").value);

  if (isNaN(min)) min = 100;
  if (isNaN(max)) max = 100;

  min = Math.max(100, Math.min(min, 1500));
  max = Math.max(100, Math.min(max, 1500));

  if (min > max) {
    [min, max] = [max, min];
  }

  document.getElementById("totalLegMin").value = min;
  document.getElementById("totalLegMax").value = max;
  document.getElementById("totalLegMinInput").value = min;
  document.getElementById("totalLegMaxInput").value = max;

//  document.getElementById("totalLegLabel").textContent = `${min} - ${max} NM`;
}

  function updateTotalLegMinFromFirstLeg() {
    const firstMin = parseInt(document.getElementById("firstLegMin").value);
    const minTotal = Math.max(100, 2 * firstMin);

    const totalMinSlider = document.getElementById("totalLegMin");
    const totalMaxSlider = document.getElementById("totalLegMax");
    const totalMinInput = document.getElementById("totalLegMinInput");
    const totalMaxInput = document.getElementById("totalLegMaxInput");

    totalMinSlider.min = minTotal;
    totalMinInput.min = minTotal;

    // Adjust current value if needed
    if (parseInt(totalMinSlider.value) < minTotal) totalMinSlider.value = minTotal;
    if (parseInt(totalMinInput.value) < minTotal) totalMinInput.value = minTotal;

    // Ensure the max is at least the new min
    if (parseInt(totalMaxSlider.value) < minTotal) totalMaxSlider.value = minTotal;
    if (parseInt(totalMaxInput.value) < minTotal) totalMaxInput.value = minTotal;

    updateTotalLegLabel();
  }

function updateTotalLegConstraints(firstMin) {
  const requiredMin = Math.max(100, firstMin * 2);
  const minInput = document.getElementById("totalLegMinInput");
  const maxInput = document.getElementById("totalLegMaxInput");
  const minSlider = document.getElementById("totalLegMin");
  const maxSlider = document.getElementById("totalLegMax");

  minSlider.min = minInput.min = requiredMin;
  maxSlider.min = maxInput.min = requiredMin;

  // Reset if below required
  if (parseInt(minInput.value) < requiredMin) {
    minInput.value = requiredMin;
    minSlider.value = requiredMin;
  }

  syncTotalLegLabel();
}

function syncTotalLegInputsFromSlider() {
  const min = document.getElementById("totalLegMin").value;
  const max = document.getElementById("totalLegMax").value;
  document.getElementById("totalLegMinInput").value = min;
  document.getElementById("totalLegMaxInput").value = max;
  updateTotalLegLabel();
}

function syncTotalLegSlidersFromInput() {
  const min = parseInt(document.getElementById("totalLegMinInput").value);
  const max = parseInt(document.getElementById("totalLegMaxInput").value);
  document.getElementById("totalLegMin").value = min;
  document.getElementById("totalLegMax").value = max;
  updateTotalLegLabel();
}

function findDestinations() {
  resetTripState(); // 🧼 Clear map, markers, UI
  const homeCode = document.getElementById("airportSelect").value;
  if (!homeCode || !airportData[homeCode]) {
    alert("Please select a valid Home Base Airport.");
    return;
  }
    
  const base = airportData[homeCode];
  const selectedSurfaces = [...document.querySelectorAll(".surface:checked")].map(el => el.value);
  const selectedAirspaces = [...document.querySelectorAll(".airspace:checked")].map(el => el.value);
  const minRunwayLength = parseInt(document.getElementById("minRunwayLength").value);
  const firstLegMin = parseInt(document.getElementById("firstLegMin").value);
  const firstLegMax = parseInt(document.getElementById("firstLegMax").value);
  const totalLegMin = parseInt(document.getElementById("totalLegMinInput").value);
  const totalLegMax = parseInt(document.getElementById("totalLegMaxInput").value);
  const isTriangle = document.querySelector('input[name="tripType"]:checked').value === "two"; 

  const results = [];
  
  for (const [code, airport] of Object.entries(airportData)) {
    if (code === homeCode) continue;
    if (!selectedAirspaces.includes(airport.airspace)) continue;
  
    const eligibleRunways = airport.runways.filter(rwy => {
      const len = parseInt(rwy.length) || 0;
      const surface = (rwy.surface || "").split("-")[0].toUpperCase();
      return len >= minRunwayLength &&
        (selectedSurfaces.includes(surface) ||
         (selectedSurfaces.includes("OTHER") &&
          !["ASPH", "CONC", "TURF"].includes(surface)));
    });

    if (eligibleRunways.length === 0) continue;

    const dist = haversine(base.lat, base.lon, airport.lat, airport.lon);
    if (dist < firstLegMin || dist > firstLegMax) continue;
    if (isTriangle && dist * 2 > totalLegMax) continue;

    results.push({
      code,
      name: airport.airport_name,
      city: airport.city,
      state: airport.state,
      distance: dist.toFixed(1),
      lat: airport.lat,
      lon: airport.lon
    });
  }

  currentFirstLegDestinations = results;
  currentLeg = 'first';
  sortCurrentResults();
  displayResults(currentFirstLegDestinations);
}

function displayResults(results, selectedCode = null) {
  const div = document.getElementById("resultArea");
  const tripType = document.querySelector('input[name="tripType"]:checked').value;

  if (results.length === 0) {
    div.innerHTML = "<p>🚫 No matching destination airports found.</p>";
    return;
  }

  let html = `<p>✅ ${results.length} destination(s) found:</p><ul class="result-list">`;
  results.forEach((r) => {
    const isChecked = r.code === selectedCode ? "checked" : ""; // Preserve selection
    html += `
      <li>
        <label style="font-size: 1.0em;">
          <input type="radio" name="firstLeg" value="${r.code}" ${isChecked}>
          <strong>${r.code}</strong> (${r.distance} NM) – ${r.name}, ${r.city}, ${r.state} | Airspace ${airportData[r.code].airspace}, Max RWY: ${getMaxRunway(airportData[r.code].runways)} ft
        </label>
      </li>
    `;
  });
  html += "</ul>";
  div.innerHTML = html;

  // Clear existing markers
  destinationMarkers.forEach(m => map.removeLayer(m));
  destinationMarkers = [];

  // Add markers with popups
  results.forEach(r => {
    const ap = airportData[r.code];
    const color = getAirspaceColor(ap.airspace);
    const marker = L.circleMarker([ap.lat, ap.lon], {
      radius: 6,
      color: color,
      fillColor: color,
      fillOpacity: 0.9,
      weight: 1
    }).addTo(map);

    marker.airportCode = r.code;
    destinationMarkers.push(marker);

    marker.bindPopup(() => {
      const popupContent = L.DomUtil.create("div");
      popupContent.innerHTML = `
        <strong>${r.code}</strong> (Class ${ap.airspace}) - ${r.distance} NM<br>
        ${ap.airport_name}<br>
        Total: ${(r.distance * 2).toFixed(1)} NM<br><br>
        <u>Runways</u><br>
        ${ap.runways.map(rwy => `
          <strong>${rwy.rwy_id}</strong>: ${rwy.length}' x ${rwy.width}' ${formatSurface(rwy.surface)} (${rwy.condition})
        `).join("<br>")}
        <button class="summary-btn">📋 Summary Report</button>
      `;
      const btn = popupContent.querySelector(".summary-btn");
      btn.addEventListener("click", () => showTwoLegSummary());
      return popupContent;
    });

    marker.on("click", () => {
      const radio = document.querySelector(`input[name="firstLeg"][value="${r.code}"]`);
      if (radio) {
        radio.checked = true;
        highlightAirport(r.code);
        if (tripType === "two") {
          drawSecondLegEllipses();
          findSecondLeg();
        }
        marker.openPopup();
      }
    });
  });

  // Re-attach event listeners for radio buttons
  const radios = document.querySelectorAll('input[name="firstLeg"]');
  if (tripType === "two") {
    radios.forEach(radio => {
      radio.addEventListener("change", () => {
        const code = radio.value;
        highlightAirport(code);
        drawSecondLegEllipses();
        findSecondLeg();
      });
    });
  } else {
    radios.forEach(radio => {
      radio.addEventListener("change", () => {
        const code = radio.value;
        highlightAirport(code);
      });
    });
  }

  // Update UI for second-leg button
  const secondBtn = document.getElementById("secondLegBtn");
  if (secondBtn) {
    if (tripType === "two") {
      secondBtn.style.display = "inline-block";
      secondBtn.textContent = "Find Second Leg";
    } else {
      secondBtn.style.display = "none";
    }
  }

  window.matchedDestinations = results;
}

function findSecondLeg() {
  const firstLegCode = document.querySelector('input[name="firstLeg"]:checked')?.value;
  if (!firstLegCode || !airportData[firstLegCode]) {
    alert("Please select a first leg destination.");
    return;
  }
  
  const baseCode = document.getElementById("airportSelect").value;
  const base = airportData[baseCode];
  const first = airportData[firstLegCode];
    
  const totalMin = parseInt(document.getElementById("totalLegMin").value);
  const totalMax = parseInt(document.getElementById("totalLegMax").value);
  
    
  const baseToFirst = haversine(base.lat, base.lon, first.lat, first.lon);
    
  const selectedSurfaces = [...document.querySelectorAll(".surface:checked")].map(el => el.value);
  const selectedAirspaces = [...document.querySelectorAll(".airspace:checked")].map(el => el.value);
  const minRunwayLength = parseInt(document.getElementById("minRunwayLength").value);
  
  const secondLegResults = [];

  for (const [code, airport] of Object.entries(airportData)) {
    if (code === baseCode || code === firstLegCode) continue;
    
    if (!selectedAirspaces.includes(airport.airspace)) continue;
      
    const eligibleRunways = airport.runways.filter(rwy => {
      const len = parseInt(rwy.length) || 0;
      const surface = (rwy.surface || "").toUpperCase().split("-")[0];
      return len >= minRunwayLength &&
        (selectedSurfaces.includes(surface) ||
         (selectedSurfaces.includes("OTHER") &&
          !["ASPH", "CONC", "TURF"].includes(surface)));
    });
    if (eligibleRunways.length === 0) continue;

    const firstToSecond = haversine(first.lat, first.lon, airport.lat, airport.lon);
    const secondToBase = haversine(airport.lat, airport.lon, base.lat, base.lon);
    const totalDistance = baseToFirst + firstToSecond + secondToBase;

    if (totalDistance >= totalMin && totalDistance <= totalMax) {
      secondLegResults.push({
        code,
        name: airport.airport_name,
        city: airport.city,
        state: airport.state,
        airspace: airport.airspace,
        totalDistance: totalDistance.toFixed(1),
        leg2Distance: firstToSecond.toFixed(1),
        leg3Distance: secondToBase.toFixed(1),
        fromCode: firstLegCode,
        homeCode: baseCode
      });
    }
  }

  currentSecondLegDestinations = secondLegResults;
  currentLeg = 'second';
  sortCurrentResults();
  displaySecondLegResults(currentSecondLegDestinations);
}

function sortCurrentResults() {
  let sortBy = document.querySelector('input[name="sortBy"]:checked').value;

  // Capture the currently selected airports for both legs
  const selectedFirstCode = document.querySelector('input[name="firstLeg"]:checked')?.value || null;
  const selectedSecondCode = document.querySelector('input[name="secondLeg"]:checked')?.value || null;

  // Sort first-leg destinations
  if (currentFirstLegDestinations.length > 0) {
    if (sortBy === 'leg_distance') {
      currentFirstLegDestinations.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));
    } else if (sortBy === 'alphabetical') {
      currentFirstLegDestinations.sort((a, b) => a.code.localeCompare(b.code));
    } else if (sortBy === 'total_distance') {
      currentFirstLegDestinations.sort((a, b) => parseFloat(a.distance * 2) - parseFloat(b.distance * 2));
    }
    displayResults(currentFirstLegDestinations, selectedFirstCode);
  }

  // Sort second-leg destinations (if they exist)
  if (currentSecondLegDestinations.length > 0) {
    if (sortBy === 'leg_distance') {
      currentSecondLegDestinations.sort((a, b) => parseFloat(a.leg2Distance) - parseFloat(b.leg2Distance));
    } else if (sortBy === 'alphabetical') {
      currentSecondLegDestinations.sort((a, b) => a.code.localeCompare(b.code));
    } else if (sortBy === 'total_distance') {
      currentSecondLegDestinations.sort((a, b) => parseFloat(a.totalDistance) - parseFloat(b.totalDistance));
    }
    displaySecondLegResults(currentSecondLegDestinations, selectedSecondCode);
  }
}

function displaySecondLegResults(results, selectedCode = null) {
  const div = document.getElementById("secondLegArea");

  if (results.length === 0) {
    div.innerHTML = "<p>🚫 No second-leg destinations found.</p>";
    return;
  }

  let html = `<h3>Second Leg Destinations</h3>`;
  html += `<p>✅ ${results.length} second-leg destination(s) found:</p><ul class="result-list">`;
  results.forEach((r) => {
    const isChecked = r.code === selectedCode ? "checked" : ""; // Preserve selection
    html += `
      <li>
        <label style="font-size: 1.0em;">
          <input type="radio" name="secondLeg" value="${r.code}" ${isChecked} onchange="drawTriangle('${r.fromCode}', '${r.code}', '${r.homeCode}')">
          <strong>${r.code}</strong> (${r.totalDistance} NM) – ${r.name}, ${r.city}, ${r.state}
        </label>
      </li>
    `;
  });
  html += "</ul>";
  div.innerHTML = html;

  // Clear previous second-leg markers
  if (secondLegMarkers) {
    secondLegMarkers.forEach(m => map.removeLayer(m));
    secondLegMarkers = [];
  }

  const firstCode = document.querySelector('input[name="firstLeg"]:checked')?.value;
  const homeCode = document.getElementById("airportSelect").value;

  results.forEach(r => {
    const ap = airportData[r.code];
    const color = getAirspaceColor(ap.airspace);

    const marker = L.marker([ap.lat, ap.lon], {
      representedBy: 'secondLegMarkers',
      icon: squareMarker(color)
    }).addTo(map)
      .bindPopup(`
        <strong>${r.code}</strong> (Class ${ap.airspace})<br>
        ${ap.airport_name}<br>
        1st Leg: ${haversine(
            airportData[r.homeCode].lat,
            airportData[r.homeCode].lon,
            airportData[r.fromCode].lat,
            airportData[r.fromCode].lon
        ).toFixed(1)} NM<br>
        2nd Leg: ${r.leg2Distance} NM<br>
        Return : ${r.leg3Distance} NM<br>
        Total  : ${r.totalDistance} NM<br><br>
        <u>Runways</u><br>
        ${ap.runways.map(rwy => `
         <strong>${rwy.rwy_id}</strong>: ${rwy.length}' x ${rwy.width}' ${formatSurface(rwy.surface)} (${rwy.condition})
        `).join("<br>")}
        <button onclick="showTripSummary()">📋 Summary Report</button>
      `);

    secondLegMarkers.push(marker);

    marker.on("click", () => {
      const radio = document.querySelector(`input[name="secondLeg"][value="${r.code}"]`);
      if (radio) {
        radio.checked = true;
        drawTriangle(r.fromCode, r.code, r.homeCode);
      }
    });
  });
}

function drawTriangle(firstCode, secondCode, homeCode) {
  const first = airportData[firstCode];
  const second = airportData[secondCode];
  const home = airportData[homeCode];

  if (legLine) {
    map.removeLayer(legLine);
    legLine = null;
  }

  if (!first || !second || !home) {
    console.warn("One or more airports are missing:", { firstCode, secondCode, homeCode });
    return;
  }

  // Clear previous lines and labels
  triangleLines.forEach(line => map.removeLayer(line));
  triangleLines = [];
  if (window.triangleLabels) { // Store labels for triangle legs
    window.triangleLabels.forEach(label => map.removeLayer(label));
    window.triangleLabels = [];
  }

  // Define all 3 legs with their coordinates
  const legs = [
    { start: home, end: first, desc: `${homeCode} to ${firstCode}` },
    { start: first, end: second, desc: `${firstCode} to ${secondCode}` },
    { start: second, end: home, desc: `${secondCode} to ${homeCode}` }
  ];

  window.triangleLabels = []; // Initialize array for labels

  // Draw each leg and add label
  legs.forEach(({ start, end, desc }) => {
    const line = L.polyline([
      [start.lat, start.lon],
      [end.lat, end.lon]
    ], {
      color: "#FF00FF",
      weight: 5,
      opacity: 0.8
    }).addTo(map);

    triangleLines.push(line);

    // Add distance label
    const label = addDistanceLabel(start.lat, start.lon, end.lat, end.lon);
    window.triangleLabels.push(label);
  });

  const firstAp = airportData[firstCode];
  const homeAp = airportData[homeCode];
  const leg1Distance = haversine(homeAp.lat, homeAp.lon, firstAp.lat, firstAp.lon);

  const totalMin = parseFloat(document.getElementById("totalLegMin").value);
  const totalMax = parseFloat(document.getElementById("totalLegMax").value);

  const remainingMin = Math.max(totalMin - leg1Distance, 0);
  const remainingMax = Math.max(totalMax - leg1Distance, 0);

  drawSecondLegRing(firstAp, remainingMin, remainingMax);
}

function drawSecondLegRing(centerAirport, minNM, maxNM) {
  if (!centerAirport || !centerAirport.lat || !centerAirport.lon) return;

  // Remove existing ring if any
  if (secondLegRing) {
    map.removeLayer(secondLegRing);
    secondLegRing = null;
  }

  const center = [centerAirport.lat, centerAirport.lon];
  const minMeters = Math.max(minNM, 0) * 1852;
  const maxMeters = Math.max(maxNM, 0) * 1852;

  // Outer bounding box (world-sized rectangle)
  const outerRing = [
    [90, -360],
    [90, 360],
    [-90, 360],
    [-90, -360],
    [90, -360]
  ];

  // Convert Leaflet circles to GeoJSON coordinates
  const inner = L.circle(center, { radius: minMeters }).toGeoJSON().geometry.coordinates[0];
  const outer = L.circle(center, { radius: maxMeters }).toGeoJSON().geometry.coordinates[0];

  const mask = {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [outer, inner]
    }
  };

  secondLegRing = L.geoJSON(mask, {
    style: {
      fillColor: "#999",
      fillOpacity: 0.3,
      stroke: false
    }
  }).addTo(map);
}


function syncTotalLegLabel() {
  const min = document.getElementById("totalLegMin").value;
  const max = document.getElementById("totalLegMax").value;
//  document.getElementById("totalLegLabel").textContent = `${min} - ${max} NM`;
}

function toggleTotalLeg() {
  resetTripState(); 
  const isTriangle = document.getElementById("tripTriangle").checked;
  document.getElementById("totalTripSlider").style.display = isTriangle ? "block" : "none";
  document.getElementById("findBtn").textContent = isTriangle ? "Find First Leg Destinations" : "Find Destinations";
  document.getElementById("resultArea").innerHTML = "";
  document.getElementById("secondLegArea").innerHTML = "";
}

function finalizeSelection() {
  const selected = document.querySelector('input[name="secondLeg"]:checked');
  if (!selected) {
    alert("Please select a second leg destination.");
    return;
  }

  const code = selected.value;
  const airport = airportData[code];
  if (!airport) {
    alert("Airport not found in data.");
    return;
  }

  alert(`✅ Final Destination Selected:\n${code} - ${airport.airport_name}\n${airport.city}, ${airport.state}`);
}

function updateLabel(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getMaxRunway(runways) {
  if (!runways || runways.length === 0) return 0;
  return Math.max(...runways.map(r => parseInt(r.length || 0)));
}

function getAirspaceColor(classCode) {
  switch (classCode) {
    case "B": return "#3399FF"; // Bright blue
    case "C": return "#FF3333"; // Bright red
    case "D": return "#0000FF"; // Bright blue
    case "E": return "#FF00FF"; // Magenta
    case "G": return "#777777"; // Gray
    default: return "#666666";
  }
}

function addMapLegend() {
  if (legendAdded) return; // ✅ prevent duplicates
  legendAdded = true;

  const legend = L.control({ position: "bottomright" });

  legend.onAdd = function () {
    const div = L.DomUtil.create("div", "info legend");
    const airspaceClasses = ["B", "C", "D", "E", "G"];
    const labels = {
      B: "Class B",
      C: "Class C",
      D: "Class D",
      E: "Class E",
      G: "Class G"
    };

    div.innerHTML += "<strong>Airspace Classes</strong><br>";

    airspaceClasses.forEach(c => {
      const color = getAirspaceColor(c);
      div.innerHTML += `
        <i style="background:${color}; width:12px; height:12px; display:inline-block; margin-right:6px;"></i>
        ${labels[c]}<br>
      `;
    });

    return div;
  };

  legend.addTo(map);
}

function highlightAirport(code) {
  const marker = destinationMarkers.find(m => m.airportCode === code);
  if (!marker) return;

  marker.openPopup();
  map.setView(marker.getLatLng(), map.getZoom());

  const ap = airportData[code];
  const homeCode = document.getElementById("airportSelect").value;
  const homeAp = airportData[homeCode];

  if (!ap || !homeAp) return;

  // Thorough cleanup of previous first-leg elements
  if (legLine) {
    map.removeLayer(legLine);
    legLine = null;
  }
  if (window.legLabel) {
    map.removeLayer(window.legLabel);
    window.legLabel = null;
  }

  // Clear triangle elements if they exist (to avoid overlap)
  if (triangleLines && triangleLines.length > 0) {
    triangleLines.forEach(line => map.removeLayer(line));
    triangleLines = [];
  }
  if (window.triangleLabels) {
    window.triangleLabels.forEach(label => map.removeLayer(label));
    window.triangleLabels = [];
  }

  // Draw new magenta line
  legLine = L.polyline([[homeAp.lat, homeAp.lon], [ap.lat, ap.lon]], {
    color: "#FF00FF",
    weight: 5,
    opacity: 0.8
  }).addTo(map);

  // Add new distance label
  window.legLabel = addDistanceLabel(homeAp.lat, homeAp.lon, ap.lat, ap.lon);
}

function formatSurface(code) {
  switch (code) {
    case "ASPH": return "Asphalt";
    case "CONC": return "Concrete";
    case "TURF": return "Grass";
    case "GRVL": return "Gravel";
    case "DIRT": return "Dirt";
    case "WATER": return "Water";
    case "OTHER": return "Other";
    default: return code;
  }
}

function resetTripState() {
  // Remove first-leg line
  if (legLine) {
    map.removeLayer(legLine);
    legLine = null;
  }

  // Remove first-leg label
  if (window.legLabel) {
    map.removeLayer(window.legLabel);
    window.legLabel = null;
  }

  // Remove triangle lines
  if (triangleLines && triangleLines.length > 0) {
    triangleLines.forEach(line => map.removeLayer(line));
    triangleLines = [];
  }

  // Remove triangle labels
  if (window.triangleLabels) {
    window.triangleLabels.forEach(label => map.removeLayer(label));
    window.triangleLabels = [];
  }

  // Remove first-leg markers
  if (Array.isArray(destinationMarkers)) {
    destinationMarkers.forEach(marker => {
      if (map.hasLayer(marker)) map.removeLayer(marker);
    });
    destinationMarkers = [];
  }

  // Remove second-leg markers
  if (Array.isArray(secondLegMarkers)) {
    secondLegMarkers.forEach(marker => {
      if (map.hasLayer(marker)) map.removeLayer(marker);
    });
    secondLegMarkers = [];
  }

  // Remove second-leg ring or ellipses
  if (secondLegRing) {
    map.removeLayer(secondLegRing);
    secondLegRing = null;
  }
  if (secondLegEllipseInner) {
    map.removeLayer(secondLegEllipseInner);
    secondLegEllipseInner = null;
  }
  if (secondLegEllipseOuter) {
    map.removeLayer(secondLegEllipseOuter);
    secondLegEllipseOuter = null;
  }

  // Clear results and UI
  document.getElementById("resultArea").innerHTML = `<p>No destinations yet. Click "Find Destinations" to search.</p>`;
  document.getElementById("secondLegArea").innerHTML = "";

  // Hide second-leg button
  document.getElementById("secondLegBtn").style.display = "none";

  // Reset current leg tracking
  currentLeg = 'first';
  currentFirstLegDestinations = [];
  currentSecondLegDestinations = [];

  // Recenter the map to home base
  const homeCode = document.getElementById("airportSelect").value;
  const homeAp = airportData[homeCode];
  if (homeAp) {
    map.setView([homeAp.lat, homeAp.lon], 8);
    if (marker) {
      map.removeLayer(marker);
    }
    marker = L.marker([homeAp.lat, homeAp.lon])
      .addTo(map)
      .bindPopup(`${homeCode} - ${homeAp.airport_name}`)
      .openPopup();
    refreshDistanceCircles();
  }

  console.log("✅ Trip state fully reset.");
}

function addDistanceLabel(startLat, startLon, endLat, endLon, color = "#000000") {
  // Calculate distance in NM
  const distance = haversine(startLat, startLon, endLat, endLon).toFixed(1);

  // Calculate midpoint (no offset)
  const midLat = (startLat + endLat) / 2;
  const midLon = (startLon + endLon) / 2;

  // Calculate angle in degrees
  const deltaLat = endLat - startLat;
  const deltaLon = endLon - startLon;
  const angleRad = Math.PI/2 + Math.atan2(deltaLon, deltaLat); // Angle in radians
  let angleDeg = angleRad * 180 / Math.PI; // Convert to degrees

  // Normalize angle to avoid upside-down text
  if (angleDeg > 90) {
    angleDeg -= 180;
  } else if (angleDeg < -90) {
    angleDeg += 180;
  }

  // Create a label centered on the line
  const label = L.marker([midLat, midLon], {
    icon: L.divIcon({
      className: "distance-label",
      html: `<div style="color: ${color}; font-size: 10px; font-style: italic; white-space: nowrap; background-color: rgba(255, 255, 255, 0.5); display: inline-block; transform: rotate(${angleDeg}deg); transform-origin: center;">${distance} NM</div>`,
      iconSize: [0, 0], // No intrinsic size
      iconAnchor: [15, 5] // Center the label
    }),
    interactive: false // Prevent mouse events on the label
  }).addTo(map);

  return label;
}

function showTripSummary() {
  const homeCode = document.getElementById("airportSelect").value;
  const firstCode = document.querySelector('input[name="firstLeg"]:checked')?.value;
  const secondCode = document.querySelector('input[name="secondLeg"]:checked')?.value;

  if (!homeCode || !firstCode || !secondCode) {
    alert("Please select all three airports to generate a summary.");
    return;
  }

  const home = airportData[homeCode];
  const first = airportData[firstCode];
  const second = airportData[secondCode];

  const getRunways = (ap) => {
    return ap.runways.map(r =>
      `    • ${r.rwy_id}: ${r.length}' x ${r.width}' ${formatSurface(r.surface)} (${r.condition})`
    ).join("\n");
  };

  const leg1 = haversine(home.lat, home.lon, first.lat, first.lon).toFixed(1);
  const leg2 = haversine(first.lat, first.lon, second.lat, second.lon).toFixed(1);
  const leg3 = haversine(second.lat, second.lon, home.lat, home.lon).toFixed(1);
  const total = (parseFloat(leg1) + parseFloat(leg2) + parseFloat(leg3)).toFixed(1);

// Fixed-width formatting for trip legs
  const codeWidth = 4; // Max width for airport codes (e.g., "KJFK" = 4, pad to 6)
  const distanceWidth = 6; // Max width for distance (e.g., "123.4" = 5, pad to 6)

  const leg1Line = `${homeCode.padEnd(codeWidth)} ➝ ${firstCode.padEnd(codeWidth)}  : ${leg1.padStart(distanceWidth)} NM`;
  const leg2Line = `${firstCode.padEnd(codeWidth)} ➝ ${secondCode.padEnd(codeWidth)}  : ${leg2.padStart(distanceWidth)} NM`;
  const leg3Line = `${secondCode.padEnd(codeWidth)} ➝ ${homeCode.padEnd(codeWidth)}  : ${leg3.padStart(distanceWidth)} NM`;
  const summary = `
🛫 Airports

Departure:
  Airport ID   : ${homeCode}
  Airspace     : Class ${home.airspace}
  Name         : ${home.airport_name}
  Runways      :
${getRunways(home)}

1st Destination:
  Airport ID   : ${firstCode}
  Airspace     : Class ${first.airspace}
  Name         : ${first.airport_name}
  Runways      :
${getRunways(first)}

2nd Destination:
  Airport ID   : ${secondCode}
  Airspace     : Class ${second.airspace}
  Name         : ${second.airport_name}
  Runways      :
${getRunways(second)}

📏 Trip Summary

  ${leg1Line}
  ${leg2Line}
  ${leg3Line}

  Total Distance: ${total} NM
  `.trim();

  document.getElementById("summaryContent").textContent = summary;
  document.getElementById("summaryModal").style.display = "block";
}

function showTwoLegSummary() {
  const homeCode = document.getElementById("airportSelect").value;
  const firstCode = document.querySelector('input[name="firstLeg"]:checked')?.value;

  if (!homeCode || !firstCode) {
    alert("Please select a departure and destination.");
    return;
  }

  const home = airportData[homeCode];
  const dest = airportData[firstCode];

  const getRunways = (ap) => {
    return ap.runways.map(r =>
      `    • ${r.rwy_id}: ${r.length}' x ${r.width}' ${formatSurface(r.surface)} (${r.condition})`
    ).join("\n");
  };

  const legOut = haversine(home.lat, home.lon, dest.lat, dest.lon).toFixed(1);
  const legBack = legOut; // symmetrical round trip
  const total = (parseFloat(legOut) * 2).toFixed(1);

// Fixed-width formatting for trip legs
  const codeWidth = 4; // Max width for airport codes (e.g., "KJFK" = 4, pad to 6)
  const distanceWidth = 6; // Max width for distance (e.g., "123.4" = 5, pad to 6)
  const leg1Line = `${homeCode.padEnd(codeWidth)} ➝ ${firstCode.padEnd(codeWidth)}  : ${legOut.padStart(distanceWidth)} NM`;
  const leg2Line = `${firstCode.padEnd(codeWidth)} ➝ ${homeCode.padEnd(codeWidth)}  : ${legBack.padStart(distanceWidth)} NM`;

  const summary = `
🛫 Airports

Departure:
  Airport ID   : ${homeCode}
  Airspace     : Class ${home.airspace}
  Name         : ${home.airport_name}
  Runways      :
${getRunways(home)}

Destination:
  Airport ID   : ${firstCode}
  Airspace     : Class ${dest.airspace}
  Name         : ${dest.airport_name}
  Runways      :
${getRunways(dest)}

📏 Trip Summary

  ${leg1Line}
  ${leg2Line}

  Total Distance: ${total} NM
`.trim();

  document.getElementById("summaryContent").textContent = summary;
  document.getElementById("summaryModal").style.display = "block";
}

function computeEllipsePoints(focusA, focusB, semiMajorNm, numPoints = 180) {
  const toRad = deg => deg * Math.PI / 180;
  const toDeg = rad => rad * 180 / Math.PI;
  const earthRadiusNm = 3440.065;

  const [latA, lonA] = focusA;
  const [latB, lonB] = focusB;

  // Midpoint (approximate ellipse center)
  const centerLat = (latA + latB) / 2;
  const centerLon = (lonA + lonB) / 2;

  // Distance between the two foci
  const distanceBetweenFoci = haversine(latA, lonA, latB, lonB);

  // Ensure the ellipse is valid
  if (semiMajorNm < distanceBetweenFoci / 2) return [];

  const semiMinorNm = Math.sqrt(semiMajorNm ** 2 - (distanceBetweenFoci / 2) ** 2);

  // Ellipse rotation (bearing from A to B)
  const bearingDeg = computeBearing(latA, lonA, latB, lonB);
  const bearingRad = toRad(bearingDeg);

  const points = [];

  for (let i = 0; i <= numPoints; i++) {
    const theta = (2 * Math.PI * i) / numPoints;

    const dx = semiMajorNm * Math.cos(theta);
    const dy = semiMinorNm * Math.sin(theta);

    // Rotate by ellipse orientation
    const xRot = dx * Math.cos(bearingRad) - dy * Math.sin(bearingRad);
    const yRot = dx * Math.sin(bearingRad) + dy * Math.cos(bearingRad);

    const pointDistance = Math.sqrt(xRot ** 2 + yRot ** 2);
    const pointBearing = (toDeg(Math.atan2(xRot, yRot)) + 360) % 360;

    const [lat, lon] = destinationPoint(centerLat, centerLon, pointBearing, pointDistance);
    points.push([lat, lon]);
  }

  return points;
}

function computeBearing(startLatDeg, startLonDeg, endLatDeg, endLonDeg) {
  const toRadians = deg => deg * Math.PI / 180;
  const toDegrees = rad => rad * 180 / Math.PI;

  const lat1 = toRadians(startLatDeg);
  const lon1 = toRadians(startLonDeg);
  const lat2 = toRadians(endLatDeg);
  const lon2 = toRadians(endLonDeg);

  const deltaLon = lon2 - lon1;

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  const thetaRad = Math.atan2(x, y);
  const bearingDeg = (toDegrees(thetaRad) + 360) % 360;

  return bearingDeg;
}

function destinationPoint(startLatDeg, startLonDeg, bearingDeg, distanceNm) {
  const earthRadiusNm = 3440.065; // Earth's radius in nautical miles
  const toRadians = deg => deg * Math.PI / 180;
  const toDegrees = rad => rad * 180 / Math.PI;

  const angularDistance = distanceNm / earthRadiusNm;
  const bearingRad = toRadians(bearingDeg);
  const startLatRad = toRadians(startLatDeg);
  const startLonRad = toRadians(startLonDeg);

  const destLatRad = Math.asin(
    Math.sin(startLatRad) * Math.cos(angularDistance) +
    Math.cos(startLatRad) * Math.sin(angularDistance) * Math.cos(bearingRad)
  );

  const destLonRad = startLonRad + Math.atan2(
    Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(startLatRad),
    Math.cos(angularDistance) - Math.sin(startLatRad) * Math.sin(destLatRad)
  );

  const destLatDeg = toDegrees(destLatRad);
  const destLonDeg = ((toDegrees(destLonRad) + 540) % 360) - 180; // normalize to [-180, 180]

  return [destLatDeg, destLonDeg];
}

function drawSecondLegEllipses() {

  const tripType = document.querySelector('input[name="tripType"]:checked')?.value;
  if (tripType !== "two") return;

  const homeCode = document.getElementById("airportSelect").value;
  const firstCode = document.querySelector('input[name="firstLeg"]:checked')?.value;

  if (!homeCode || !firstCode) return;

  const home = airportData[homeCode];
  const first = airportData[firstCode];

  const actualFirstLeg = haversine(home.lat, home.lon, first.lat, first.lon);

  const totalMin = parseFloat(document.getElementById("totalLegMin").value);
  const totalMax = parseFloat(document.getElementById("totalLegMax").value);

  // 🧹 Remove old ellipses
  if (secondLegEllipseInner) {
    map.removeLayer(secondLegEllipseInner);
    secondLegEllipseInner = null;
  }
  if (secondLegEllipseOuter) {
    map.removeLayer(secondLegEllipseOuter);
    secondLegEllipseOuter = null;
  }

  // 🟠 Outer ellipse
  const outerPoints = computeEllipsePoints(
    [home.lat, home.lon],
    [first.lat, first.lon],
    (totalMax - actualFirstLeg)/ 2
  );
  secondLegEllipseOuter = L.polygon(outerPoints, {
    color: "#FFA500",
    weight: 2,
    dashArray: "5, 5",
    interactive: false,
    fillOpacity: 0.05,
    pane: "ellipsePane"
  }).addTo(map);

  // 🟢 Inner ellipse
  const innerPoints = computeEllipsePoints(
    [home.lat, home.lon],
    [first.lat, first.lon],
    (totalMin - actualFirstLeg) / 2
  );
  secondLegEllipseInner = L.polygon(innerPoints, {
    color: "#32CD32",
    weight: 2,
    dashArray: "2, 6",
    interactive: false,
    fillOpacity: 0.05,
    pane: "ellipsePane"
  }).addTo(map);
}

function resetSecondLeg() {
  // Clear second-leg results UI
  document.getElementById("secondLegArea").innerHTML = "";

  // Remove second-leg markers
  if (secondLegMarkers) {
    secondLegMarkers.forEach(m => map.removeLayer(m));
    secondLegMarkers = [];
  }

  // Remove triangle lines (second and third legs)
  if (triangleLines) {
    triangleLines.forEach(line => map.removeLayer(line));
    triangleLines = [];
  }

  // Remove second-leg ellipses
  if (secondLegEllipseInner) {
    map.removeLayer(secondLegEllipseInner);
    secondLegEllipseInner = null;
  }
  if (secondLegEllipseOuter) {
    map.removeLayer(secondLegEllipseOuter);
    secondLegEllipseOuter = null;
  }

  // Note: Do NOT remove legLine here to preserve first-leg visualization
  console.log("Second-leg state reset, first-leg preserved.");
}

function showCredits() {
  alert(`🛫 Cross Country Flight Planner

Software Version: ${APP_VERSION}
Last Updated: ${FILE_DATE}
Database Version: ${DATABASE_VERSION}

Built with 💻 + 🛩️  with lots of ❤️ 🩵
© Copyright 2025 pilot.drchoi@gmail.com. All rights reserved.
`);
}

window.onload = () => {
  initMap();
  loadData();
  updateFirstLegLabel();
  syncTotalLegLabel();

  // Elements to sync
  const sliders = ["firstLegMin", "firstLegMax"];
  const inputs = ["firstLegMinInput", "firstLegMaxInput"];

  // Sliders update inputs and map
  sliders.forEach(id => {
    document.getElementById(id).addEventListener("input", () => {
      syncFirstLegInputsFromSlider(); // Sync inputs from sliders
      refreshDistanceCircles();       // Update map
    });
  });

  // Inputs update sliders and map
  inputs.forEach(id => {
    document.getElementById(id).addEventListener("input", () => {
      syncFirstLegSlidersFromInput(); // Sync sliders from inputs
      refreshDistanceCircles();       // Update map
    });
  });
};

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("firstLegMin").addEventListener("input", updateTotalLegMinFromFirstLeg);
  document.getElementById("firstLegMinInput").addEventListener("change", updateTotalLegMinFromFirstLeg);
  document.getElementById("titleHeading").addEventListener("click", async () => {
    await loadDatabaseVersion();
    showCredits();
  });
});

document.querySelectorAll('input[name="tripType"]').forEach(radio => {
  radio.addEventListener("change", resetTripState);
});

["totalLegMin", "totalLegMax", "totalLegMinInput", "totalLegMaxInput"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", () => {
    drawSecondLegEllipses();
  });
});

