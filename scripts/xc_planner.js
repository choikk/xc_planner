let APP_VERSION = "v1.3"; // or whatever you like
let FILE_DATE = new Date(document.lastModified).toISOString().split("T")[0];
let DATABASE_VERSION = "UNKNOWN"; // default fallback

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
    const response = await fetch("json_data/airport_base_info_with_runways_airspace_approaches.json");
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    airportData = await response.json();
    console.log("Airport data loaded:", airportData["00AL"]);
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
    console.log(`Country selected: ${selectedCountry}`);
    const states = [...statesByCountry[selectedCountry]].sort();

    if (selectedCountry !== "US" && states.length === 1 && states[0] === "unknown") {
      document.getElementById("stateSelect").innerHTML = '<option value="unknown">N/A</option>';
      document.getElementById("stateSelect").disabled = true;
    } else {
      populateSelect("stateSelect", states);
      document.getElementById("stateSelect").disabled = false;
    }
    document.getElementById("airportSelect").innerHTML = "";
    document.getElementById("homeBaseInfo").innerHTML = "";

    if (states.length > 0) {
      const stateSelect = document.getElementById("stateSelect");
      stateSelect.value = states[0];
      console.log(`Auto-selecting state: ${states[0]}`);
      const key = `${selectedCountry}-${states[0]}`;
      const airports = airportsByState[key] || [];
      airports.sort((a, b) => a.code.localeCompare(b.code));
      console.log(`Airports for ${key}: ${airports.length}`);

      populateSelect("airportSelect", airports.map(a => `${a.code} - ${a.name}`), airports.map(a => a.code));
      if (airports.length > 0) {
        const airportSelect = document.getElementById("airportSelect");
        airportSelect.value = airports[0].code;
        console.log(`Auto-selecting airport: ${airports[0].code}`);
        const code = airports[0].code;
        const ap = airportData[code];
        document.getElementById("homeBaseInfo").innerHTML = `
          <strong>${code} - ${ap.airport_name}</strong><br>
          ${ap.city}, ${ap.state === "unknown" ? "N/A" : ap.state}, ${ap.country}<br>
          Airspace: ${ap.airspace}<br>
          <strong>Runways:</strong><br>
          ${ap.runways.map(r => `${r.rwy_id}: ${r.length} ft, ${r.surface}, ${r.condition}`).join("<br>")}
        `;
        updateMap(ap.lat, ap.lon, `${code} - ${ap.airport_name}`);
        map.setView([ap.lat, ap.lon], 7);
      } else {
        document.getElementById("airportSelect").innerHTML = "<option value=''>No airports available</option>";
      }
    }
  });

  document.getElementById("stateSelect").addEventListener("change", () => {
    const selectedCountry = document.getElementById("countrySelect").value;
    const selectedState = document.getElementById("stateSelect").value;
    const key = `${selectedCountry}-${selectedState}`;
    console.log(`State selected: ${selectedState}, Key: ${key}`);
    const airports = airportsByState[key] || [];
    airports.sort((a, b) => a.code.localeCompare(b.code));
    console.log(`Airports found: ${airports.length}`);

    populateSelect("airportSelect", airports.map(a => `${a.code} - ${a.name}`), airports.map(a => a.code));
    if (airports.length > 0) {
      const airportSelect = document.getElementById("airportSelect");
      const code = airports[0].code;
      airportSelect.value = code;
      console.log(`Auto-selecting airport: ${code}`);
      const ap = airportData[code];
      document.getElementById("homeBaseInfo").innerHTML = `
        <strong>${code} - ${ap.airport_name}</strong><br>
        ${ap.city}, ${ap.state === "unknown" ? "N/A" : ap.state}, ${ap.country}<br>
        Airspace: ${ap.airspace}<br>
        <strong>Runways:</strong><br>
        ${ap.runways.map(r => `${r.rwy_id}: ${r.length} ft, ${r.surface}, ${r.condition}`).join("<br>")}
      `;
      updateMap(ap.lat, ap.lon, `${code} - ${ap.airport_name}`);
      map.setView([ap.lat, ap.lon], 7);
    } else {
      document.getElementById("airportSelect").innerHTML = "<option value=''>No airports available</option>";
    }
  });

  const airportSelect = document.getElementById("airportSelect");
  airportSelect.addEventListener("change", () => {
    const code = airportSelect.value;
    console.log(`Airport selected: ${code}`);
    const ap = airportData[code];
    if (!ap) return;
    document.getElementById("homeBaseInfo").innerHTML = `
      <strong>${code} - ${ap.airport_name}</strong><br>
      ${ap.city}, ${ap.state === "unknown" ? "N/A" : ap.state}, ${ap.country}<br>
      Airspace: ${ap.airspace}<br>
      <strong>Runways:</strong><br>
      ${ap.runways.map(r => `${r.rwy_id}: ${r.length} ft, ${r.surface}, ${r.condition}`).join("<br>")}
    `;
    updateMap(ap.lat, ap.lon, `${code} - ${ap.airport_name}`);
    resetTripState();
    map.setView([ap.lat, ap.lon], 7);
    // Save the selected airport as the default home base
    localStorage.setItem("defaultHomeBase", code);
    console.log(`Saved default home base: ${code}`);
  });

  // Load the saved home base or set initial default
  const savedHomeBase = localStorage.getItem("defaultHomeBase");
  if (savedHomeBase && airportData[savedHomeBase]) {
    console.log(`Loading saved home base: ${savedHomeBase}`);
    const ap = airportData[savedHomeBase];
    const country = ap.country;
    const state = ap.state;

    document.getElementById("countrySelect").value = country;
    const countryEvent = new Event("change");
    document.getElementById("countrySelect").dispatchEvent(countryEvent);

    document.getElementById("stateSelect").value = state;
    const stateEvent = new Event("change");
    document.getElementById("stateSelect").dispatchEvent(stateEvent);

    const key = `${country}-${state}`;
    const airports = airportsByState[key] || [];
    airports.sort((a, b) => a.code.localeCompare(b.code));
    populateSelect("airportSelect", airports.map(a => `${a.code} - ${a.name}`), airports.map(a => a.code));
    airportSelect.value = savedHomeBase;

    document.getElementById("homeBaseInfo").innerHTML = `
      <strong>${savedHomeBase} - ${ap.airport_name}</strong><br>
      ${ap.city}, ${ap.state === "unknown" ? "N/A" : ap.state}, ${ap.country}<br>
      Airspace: ${ap.airspace}<br>
      <strong>Runways:</strong><br>
      ${ap.runways.map(r => `${r.rwy_id}: ${r.length} ft, ${r.surface}, ${r.condition}`).join("<br>")}
    `;
    updateMap(ap.lat, ap.lon, `${savedHomeBase} - ${ap.airport_name}`);
    map.setView([ap.lat, ap.lon], 7);
  } else {
    // Fallback to initial default (e.g., "00AL")
    document.getElementById("countrySelect").value = "US";
    const initialCountryEvent = new Event("change");
    document.getElementById("countrySelect").dispatchEvent(initialCountryEvent);
  }
}

function initMap() {
  map = L.map("map").setView([39.8283, -98.5795], 7); // Centered on U.S.

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  // 🟦 Custom pane for ellipses behind everything
  map.createPane("ellipsePane");
  map.getPane("ellipsePane").style.zIndex = 299; // lower than default markers
}

function updateMap(lat, lon, label, preserveZoom = true) {
  if (!map) return;

  const currentZoom = preserveZoom ? map.getZoom() : 8; // Default to 8 only if not preserving
  map.setView([lat, lon], currentZoom);

  if (marker) map.removeLayer(marker);
  marker = L.marker([lat, lon]).addTo(map).bindPopup(label).openPopup();

  refreshDistanceCircles();
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

function updateTotalLegConstraints() {
    const firstMin = parseInt(document.getElementById("firstLegMin").value);
    const requiredMin = Math.max(100, firstMin * 2);
    const minSlider = document.getElementById("totalLegMin");
    const maxSlider = document.getElementById("totalLegMax");
    const minInput = document.getElementById("totalLegMinInput");
    const maxInput = document.getElementById("totalLegMaxInput");

    minSlider.min = minInput.min = requiredMin;
    maxSlider.min = maxInput.min = requiredMin;

    if (parseInt(minSlider.value) < requiredMin) minSlider.value = requiredMin;
    if (parseInt(minInput.value) < requiredMin) minInput.value = requiredMin;
    if (parseInt(maxSlider.value) < requiredMin) maxSlider.value = requiredMin;
    if (parseInt(maxInput.value) < requiredMin) maxInput.value = requiredMin;

    updateDualSlider(minSlider, maxSlider, document.getElementById("totalLegMinValue"), document.getElementById("totalLegMaxValue"), minInput, maxInput, drawSecondLegEllipses);
}

function updateDualSlider(sliderMin, sliderMax, valueMin, valueMax, inputMin, inputMax, callback) {
    let minVal = parseInt(sliderMin.value);
    let maxVal = parseInt(sliderMax.value);

    // Ensure min <= max
    if (minVal > maxVal) {
        [minVal, maxVal] = [maxVal, minVal];
        sliderMin.value = minVal;
        sliderMax.value = maxVal;
    }

    // Update displayed values
    valueMin.textContent = minVal;
    valueMax.textContent = maxVal;

    // Sync number inputs
    inputMin.value = minVal;
    inputMax.value = maxVal;

    // Calculate percentages for range highlight
    const minPercent = ((minVal - sliderMin.min) / (sliderMin.max - sliderMin.min)) * 100;
    const maxPercent = ((maxVal - sliderMax.min) / (sliderMax.max - sliderMax.min)) * 100;

    // Update CSS custom properties
    const track = sliderMin.parentElement;
    track.style.setProperty("--range-start", `${minPercent}%`);
    track.style.setProperty("--range-width", `${maxPercent - minPercent}%`);

    // Call additional update function (e.g., refreshDistanceCircles)
    if (callback) callback();
}

function syncSliderFromInput(sliderMin, sliderMax, inputMin, inputMax, callback) {
    let minVal = parseInt(inputMin.value) || parseInt(inputMin.min);
    let maxVal = parseInt(inputMax.value) || parseInt(inputMax.min);

    minVal = Math.max(parseInt(sliderMin.min), Math.min(minVal, parseInt(sliderMin.max)));
    maxVal = Math.max(parseInt(sliderMax.min), Math.min(maxVal, parseInt(sliderMax.max)));

    if (minVal > maxVal) {
        [minVal, maxVal] = [maxVal, minVal];
    }

    sliderMin.value = minVal;
    sliderMax.value = maxVal;
    updateDualSlider(sliderMin, sliderMax, inputMin.parentElement.previousElementSibling.querySelector("#" + sliderMin.id.replace("Min", "MinValue")), inputMax.parentElement.previousElementSibling.querySelector("#" + sliderMax.id.replace("Max", "MaxValue")), inputMin, inputMax, callback);
}

function updateTotalLegConstraints() {
    const firstMin = parseInt(document.getElementById("firstLegMin").value);
    const requiredMin = Math.max(100, firstMin * 2); // Minimum total distance is 2x first leg min, or 100 NM
    const minSlider = document.getElementById("totalLegMin");
    const maxSlider = document.getElementById("totalLegMax");
    const minInput = document.getElementById("totalLegMinInput");
    const maxInput = document.getElementById("totalLegMaxInput");

    minSlider.min = minInput.min = requiredMin;
    maxSlider.min = maxInput.min = requiredMin;

    if (parseInt(minSlider.value) < requiredMin) minSlider.value = requiredMin;
    if (parseInt(minInput.value) < requiredMin) minInput.value = requiredMin;
    if (parseInt(maxSlider.value) < requiredMin) maxSlider.value = requiredMin;
    if (parseInt(maxInput.value) < requiredMin) maxInput.value = requiredMin;

    updateDualSlider(minSlider, maxSlider, document.getElementById("totalLegMinValue"), document.getElementById("totalLegMaxValue"), minInput, maxInput, drawSecondLegEllipses);
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
  const selectedApproaches = [...document.querySelectorAll(".approach:checked")].map(el => el.value); // Includes "None" if checked
  const minRunwayLength = parseInt(document.getElementById("minRunwayLength").value);
  const firstLegMin = parseInt(document.getElementById("firstLegMin").value);
  const firstLegMax = parseInt(document.getElementById("firstLegMax").value);
  const totalLegMin = parseInt(document.getElementById("totalLegMinInput").value);
  const totalLegMax = parseInt(document.getElementById("totalLegMaxInput").value);
  const isTriangle = document.querySelector('input[name="tripType"]:checked').value === "two"; 

  const results = [];
  
  for (const [code, airport] of Object.entries(airportData)) {
    if (code === homeCode) continue;
    if (!selectedAirspaces.includes(airport.airspace)) continue; // OR logic for airspace
    
    const eligibleRunways = airport.runways.filter(rwy => {
      const len = parseInt(rwy.length) || 0;
      const surface = (rwy.surface || "").split("-")[0].toUpperCase();
      return len >= minRunwayLength &&
        (selectedSurfaces.includes(surface) ||
         (selectedSurfaces.includes("OTHER") &&
          !["ASPH", "CONC", "TURF"].includes(surface)));
    });
    if (eligibleRunways.length === 0) continue;

    // Filter by instrument approaches with OR logic
    if (selectedApproaches.length > 0) {
      const hasApproachesField = 'approaches' in airport;
      const isEmptyApproaches = hasApproachesField && Array.isArray(airport.approaches) && airport.approaches.length === 0;
      const hasApproaches = hasApproachesField && Array.isArray(airport.approaches) && airport.approaches.length > 0;

      let matchesAnyApproach = false;
      if (hasApproaches) {
        matchesAnyApproach = selectedApproaches.some(approach => {
          if (approach === "RNAV") {
            return airport.approaches.some(ap => ap.name.toUpperCase().includes("RNAV"));
          }
          if (approach === "ILS/LOC") {
            return airport.approaches.some(ap => 
              ap.name.toUpperCase().includes("ILS") || ap.name.toUpperCase().includes("LOC")
            );
          }
          if (approach === "VOR/NDB") {
            return airport.approaches.some(ap => 
              ap.name.toUpperCase().includes("VOR") || ap.name.toUpperCase().includes("NDB")
            );
          }
          return false;
        });
      }
      const matchesNone = isEmptyApproaches && selectedApproaches.includes("None");

      // OR logic: include if it matches any selected condition
      if (!matchesAnyApproach && !matchesNone) continue;
    }

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
    const isChecked = r.code === selectedCode ? "checked" : "";
    const ap = airportData[r.code];
    const approaches = ap.approaches && ap.approaches.length > 0 
      ? ap.approaches.map(ap => ap.name).join(", ") 
      : "None";
    html += `
      <li>
        <label style="font-size: 1.0em;">
          <input type="radio" name="firstLeg" value="${r.code}" ${isChecked}>
          <strong>${r.code}</strong> (${r.distance} NM) – ${r.name}, ${r.city}, ${r.state} 
          | Airspace: ${ap.airspace} | Approaches: ${approaches}
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

    // Combine runways and approaches
    let runwaysAndApproaches = ap.runways.map(rwy => 
      `• ${rwy.rwy_id}: ${rwy.length}' x ${rwy.width}' ${formatSurface(rwy.surface)} (${rwy.condition})`
    ).join("<br>");
    if (ap.approaches && ap.approaches.length > 0) {
      runwaysAndApproaches += "<br><br><strong>Instrument Approaches:</strong><br>" + 
        ap.approaches.map(ap => 
          `• <a href="${ap.pdf_url}" target="_blank">${ap.name}</a>`
        ).join("<br>");
    } else {
      runwaysAndApproaches += "<br><br><strong>Instrument Approaches:</strong><br>• None";
    }

    marker.bindPopup(`
      <div>
        <strong>${r.code}</strong> (Class ${ap.airspace}) - ${r.distance} NM<br>
        ${ap.airport_name}<br>
        Total: ${(r.distance * 2).toFixed(1)} NM<br><br>
        <strong>Runways</strong>:<br>${runwaysAndApproaches || "No runway data available"}<br>
        <button onclick="showTwoLegSummary()">📋 Summary Report</button>
      </div>
    `);

//    marker.bindPopup(() => {
//      const popupContent = L.DomUtil.create("div");
//      popupContent.innerHTML = `
//        <strong>${r.code}</strong> (Class ${ap.airspace}) - ${r.distance} NM<br>
//        ${ap.airport_name}<br>
//        Total: ${(r.distance * 2).toFixed(1)} NM<br><br>
//        <strong>Runways</strong>:<br>${runwaysAndApproaches}<br>
//        <button class="summary-btn">📋 Summary Report</button>
//      `;
//      const btn = popupContent.querySelector(".summary-btn");
//      btn.addEventListener("click", () => showTwoLegSummary());
//      return popupContent;
//    });

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
        // Open popup for the selected first destination in triangle mode
        const marker = destinationMarkers.find(m => m.airportCode === code);
        if (marker) {
          marker.openPopup();
        }
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

  // Open popup for pre-selected destination (if any) in triangle mode
  if (tripType === "two" && selectedCode) {
    const marker = destinationMarkers.find(m => m.airportCode === selectedCode);
    if (marker) {
      marker.openPopup();
    }
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
  const selectedApproaches = [...document.querySelectorAll(".approach:checked")].map(el => el.value); // Includes "None" if checked
  const minRunwayLength = parseInt(document.getElementById("minRunwayLength").value);
  
  const secondLegResults = [];

  for (const [code, airport] of Object.entries(airportData)) {
    if (code === baseCode || code === firstLegCode) continue;
    
    if (!selectedAirspaces.includes(airport.airspace)) continue; // OR logic for airspace
      
    const eligibleRunways = airport.runways.filter(rwy => {
      const len = parseInt(rwy.length) || 0;
      const surface = (rwy.surface || "").toUpperCase().split("-")[0];
      return len >= minRunwayLength &&
        (selectedSurfaces.includes(surface) ||
         (selectedSurfaces.includes("OTHER") &&
          !["ASPH", "CONC", "TURF"].includes(surface)));
    });
    if (eligibleRunways.length === 0) continue;

    // Filter by instrument approaches with OR logic
    if (selectedApproaches.length > 0) {
      const hasApproachesField = 'approaches' in airport;
      const isEmptyApproaches = hasApproachesField && Array.isArray(airport.approaches) && airport.approaches.length === 0;
      const hasApproaches = hasApproachesField && Array.isArray(airport.approaches) && airport.approaches.length > 0;

      let matchesAnyApproach = false;
      if (hasApproaches) {
        matchesAnyApproach = selectedApproaches.some(approach => {
          if (approach === "RNAV") {
            return airport.approaches.some(ap => ap.name.toUpperCase().includes("RNAV"));
          }
          if (approach === "ILS/LOC") {
            return airport.approaches.some(ap => 
              ap.name.toUpperCase().includes("ILS") || ap.name.toUpperCase().includes("LOC")
            );
          }
          if (approach === "VOR/NDB") {
            return airport.approaches.some(ap => 
              ap.name.toUpperCase().includes("VOR") || ap.name.toUpperCase().includes("NDB")
            );
          }
          return false;
        });
      }
      const matchesNone = isEmptyApproaches && selectedApproaches.includes("None");

      // OR logic: include if it matches any selected condition
      if (!matchesAnyApproach && !matchesNone) continue;
    }

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
    const isChecked = r.code === selectedCode ? "checked" : "";
    const ap = airportData[r.code];
    const approaches = ap.approaches && ap.approaches.length > 0 
      ? ap.approaches.map(ap => ap.name).join(", ") 
      : "None";
    html += `
      <li>
        <label style="font-size: 1.0em;">
          <input type="radio" name="secondLeg" value="${r.code}" ${isChecked} onchange="drawTriangle('${r.fromCode}', '${r.code}', '${r.homeCode}')">
          <strong>${r.code}</strong> (${r.totalDistance} NM) – ${r.name}, ${r.city}, ${r.state}
          | Airspace: ${r.airspace} | Approaches: ${approaches}
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

    // Combine runways and approaches
    let runwaysAndApproaches = ap.runways.map(rwy => 
      `• ${rwy.rwy_id}: ${rwy.length}' x ${rwy.width}' ${formatSurface(rwy.surface)} (${rwy.condition})`
    ).join("<br>");
    if (ap.approaches && ap.approaches.length > 0) {
      runwaysAndApproaches += "<br><br><strong>Instrument Approaches:</strong><br>" + 
        ap.approaches.map(ap => 
          `• <a href="${ap.pdf_url}" target="_blank">${ap.name}</a>`
        ).join("<br>");
    } else {
      runwaysAndApproaches += "<br><br><strong>Instrument Approaches:</strong><br>• None";
    }

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
        Return: ${r.leg3Distance} NM<br>
        Total: ${r.totalDistance} NM<br>
        <strong>Runways</strong>:<br>${runwaysAndApproaches}<br>
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

  // Recenter the map to home base, preserving current zoom
  const homeCode = document.getElementById("airportSelect").value;
  const homeAp = airportData[homeCode];
  if (homeAp) {
    map.setView([homeAp.lat, homeAp.lon], map.getZoom()); // Preserve zoom
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
    alert("Please select Home Base, First Leg, and Second Leg airports.");
    return;
  }

  const home = airportData[homeCode];
  const first = airportData[firstCode];
  const second = airportData[secondCode];

  const leg1 = haversine(home.lat, home.lon, first.lat, first.lon);
  const leg2 = haversine(first.lat, first.lon, second.lat, second.lon);
  const leg3 = haversine(second.lat, second.lon, home.lat, home.lon);
  const totalDist = leg1 + leg2 + leg3;

  let homeRunwaysAndApproaches = home.runways.map(rwy => 
    `• ${rwy.rwy_id}: ${rwy.length}' x ${rwy.width}' ${formatSurface(rwy.surface)} (${rwy.condition})`
  ).join("<br>") || "No runway data";
  if (home.approaches && home.approaches.length > 0) {
    homeRunwaysAndApproaches += "<br><br><strong>Instrument Approaches:</strong><br>" + 
      home.approaches.map(ap => 
        `• <a href="${ap.pdf_url}" target="_blank">${ap.name}</a>`
      ).join("<br>");
  } else {
    homeRunwaysAndApproaches += "<br><br><strong>Instrument Approaches:</strong><br>• None";
  }

  let firstRunwaysAndApproaches = first.runways.map(rwy => 
    `• ${rwy.rwy_id}: ${rwy.length}' x ${rwy.width}' ${formatSurface(rwy.surface)} (${rwy.condition})`
  ).join("<br>") || "No runway data";
  if (first.approaches && first.approaches.length > 0) {
    firstRunwaysAndApproaches += "<br><br><strong>Instrument Approaches:</strong><br>" + 
      first.approaches.map(ap => 
        `• <a href="${ap.pdf_url}" target="_blank">${ap.name}</a>`
      ).join("<br>");
  } else {
    firstRunwaysAndApproaches += "<br><br><strong>Instrument Approaches:</strong><br>• None";
  }

  let secondRunwaysAndApproaches = second.runways.map(rwy => 
    `• ${rwy.rwy_id}: ${rwy.length}' x ${rwy.width}' ${formatSurface(rwy.surface)} (${rwy.condition})`
  ).join("<br>") || "No runway data";
  if (second.approaches && second.approaches.length > 0) {
    secondRunwaysAndApproaches += "<br><br><strong>Instrument Approaches:</strong><br>" + 
      second.approaches.map(ap => 
        `• <a href="${ap.pdf_url}" target="_blank">${ap.name}</a>`
      ).join("<br>");
  } else {
    secondRunwaysAndApproaches += "<br><br><strong>Instrument Approaches:</strong><br>• None";
  }

  const summary = `
    <div class="summary-container">
      <h1>🛫 Cross Country Trip Summary</h1>
      <div class="airport-section">
        <h2>Home Base: ${homeCode}</h2>
        <p class="airport-info">${home.airport_name}, ${home.city}, ${home.state} <span class="airspace">(Class ${home.airspace})</span></p>
        <p class="details"><strong>Runways & Approaches:</strong><br>${homeRunwaysAndApproaches}</p>
      </div>
      <div class="airport-section">
        <h2>First Destination: ${firstCode}</h2>
        <p class="airport-info">${first.airport_name}, ${first.city}, ${first.state} <span class="airspace">(Class ${first.airspace})</span></p>
        <p class="details"><strong>Runways & Approaches:</strong><br>${firstRunwaysAndApproaches}</p>
      </div>
      <div class="airport-section">
        <h2>Second Destination: ${secondCode}</h2>
        <p class="airport-info">${second.airport_name}, ${second.city}, ${second.state} <span class="airspace">(Class ${second.airspace})</span></p>
        <p class="details"><strong>Runways & Approaches:</strong><br>${secondRunwaysAndApproaches}</p>
      </div>
      <div class="distance-section">
        <h3>📏 Trip Distances</h3>
        <p>${homeCode} ➝ ${firstCode}: ${leg1.toFixed(1)} NM</p>
        <p>${firstCode} ➝ ${secondCode}: ${leg2.toFixed(1)} NM</p>
        <p>${secondCode} ➝ ${homeCode}: ${leg3.toFixed(1)} NM</p>
        <p><strong>Total Distance:</strong> ${totalDist.toFixed(1)} NM</p>
      </div>
      <div class="map-section">
        <h3>Map Snapshot</h3>
        <div id="mapSnapshot"></div>
      </div>
    </div>
  `;

  const styles = `
    <style>
      body { font-family: 'Arial', sans-serif; margin: 10px; background-color: #f5f6f5; color: #333; line-height: 1.4; }
      .summary-container { max-width: 600px; margin: 0 auto; padding: 15px; background-color: #fff; border-radius: 6px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
      h1 { font-size: 20px; color: #1a73e8; text-align: center; margin-bottom: 15px; }
      .airport-section { margin-bottom: 10px; padding: 10px; background-color: #fafafa; border-left: 3px solid #1a73e8; border-radius: 4px; }
      h2 { font-size: 16px; color: #555; margin: 0 0 5px 0; }
      .airport-info { font-size: 14px; margin: 0 0 5px 0; }
      .airspace { font-size: 12px; color: #777; }
      .details { font-size: 12px; margin: 0; }
      .distance-section { text-align: center; padding: 10px; background-color: #e8f0fe; border-radius: 4px; margin-bottom: 10px; }
      .map-section { text-align: center; padding: 10px; background: none; }
      h3 { font-size: 14px; color: #1a73e8; margin: 0 0 5px 0; }
      p { margin: 3px 0; }
      a { color: #1a73e8; text-decoration: none; }
      a:hover { text-decoration: underline; }
      #mapSnapshot { background: none; width: 600px; height: 400px; margin: 0 auto; }
      #mapSnapshot img { width: 600px; height: 400px; display: block; margin: 0 auto; border: 1px solid #ddd; border-radius: 4px; }
    </style>
  `;

  const reportWindow = window.open("", "Trip Summary", "width=650,height=700");
  reportWindow.document.write(`<html><head><title>Cross Country Trip Summary</title>${styles}</head><body>${summary}</body></html>`);

  captureMapAsPNG(homeCode, firstCode, secondCode, dataUrl => {
    if (dataUrl) {
      const img = reportWindow.document.createElement("img");
      img.src = dataUrl;
      reportWindow.document.getElementById("mapSnapshot").appendChild(img);
    } else {
      reportWindow.document.getElementById("mapSnapshot").innerHTML = "<p>Failed to capture map.</p>";
    }
  });

  reportWindow.document.close();
}

function showTwoLegSummary() {
  const homeCode = document.getElementById("airportSelect").value;
  const destCode = document.querySelector('input[name="firstLeg"]:checked')?.value;

  if (!homeCode || !destCode) {
    alert("Please select both a Home Base Airport and a First Leg Destination.");
    return;
  }

  const home = airportData[homeCode];
  const dest = airportData[destCode];
  const dist = haversine(home.lat, home.lon, dest.lat, dest.lon);
  const totalDist = dist * 2;

  let homeRunwaysAndApproaches = home.runways.map(rwy => 
    `• ${rwy.rwy_id}: ${rwy.length}' x ${rwy.width}' ${formatSurface(rwy.surface)} (${rwy.condition})`
  ).join("<br>") || "No runway data";
  if (home.approaches && home.approaches.length > 0) {
    homeRunwaysAndApproaches += "<br><br><strong>Instrument Approaches:</strong><br>" + 
      home.approaches.map(ap => 
        `• <a href="${ap.pdf_url}" target="_blank">${ap.name}</a>`
      ).join("<br>");
  } else {
    homeRunwaysAndApproaches += "<br><br><strong>Instrument Approaches:</strong><br>• None";
  }

  let destRunwaysAndApproaches = dest.runways.map(rwy => 
    `• ${rwy.rwy_id}: ${rwy.length}' x ${rwy.width}' ${formatSurface(rwy.surface)} (${rwy.condition})`
  ).join("<br>") || "No runway data";
  if (dest.approaches && dest.approaches.length > 0) {
    destRunwaysAndApproaches += "<br><br><strong>Instrument Approaches:</strong><br>" + 
      dest.approaches.map(ap => 
        `• <a href="${ap.pdf_url}" target="_blank">${ap.name}</a>`
      ).join("<br>");
  } else {
    destRunwaysAndApproaches += "<br><br><strong>Instrument Approaches:</strong><br>• None";
  }

  const summary = `
    <div class="summary-container">
      <h1>🛫 Cross Country Trip Summary</h1>
      <div class="airport-section">
        <h2>Home Base: ${homeCode}</h2>
        <p class="airport-info">${home.airport_name}, ${home.city}, ${home.state} <span class="airspace">(Class ${home.airspace})</span></p>
        <p class="details"><strong>Runways & Approaches:</strong><br>${homeRunwaysAndApproaches}</p>
      </div>
      <div class="airport-section">
        <h2>Destination: ${destCode}</h2>
        <p class="airport-info">${dest.airport_name}, ${dest.city}, ${dest.state} <span class="airspace">(Class ${dest.airspace})</span></p>
        <p class="details"><strong>Runways & Approaches:</strong><br>${destRunwaysAndApproaches}</p>
      </div>
      <div class="distance-section">
        <h3>📏 Trip Distances</h3>
        <p>One-Way: ${dist.toFixed(1)} NM</p>
        <p>Round-Trip: ${totalDist.toFixed(1)} NM</p>
      </div>
      <div class="map-section">
        <h3>Map Snapshot</h3>
        <div id="mapSnapshot"></div>
      </div>
    </div>
  `;

  const styles = `
    <style>
      body { font-family: 'Arial', sans-serif; margin: 10px; background-color: #f5f6f5; color: #333; line-height: 1.4; }
      .summary-container { max-width: 600px; margin: 0 auto; padding: 15px; background-color: #fff; border-radius: 6px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
      h1 { font-size: 20px; color: #1a73e8; text-align: center; margin-bottom: 15px; }
      .airport-section { margin-bottom: 10px; padding: 10px; background-color: #fafafa; border-left: 3px solid #1a73e8; border-radius: 4px; }
      h2 { font-size: 16px; color: #555; margin: 0 0 5px 0; }
      .airport-info { font-size: 14px; margin: 0 0 5px 0; }
      .airspace { font-size: 12px; color: #777; }
      .details { font-size: 12px; margin: 0; }
      .distance-section { text-align: center; padding: 10px; background-color: #e8f0fe; border-radius: 4px; margin-bottom: 10px; }
      .map-section { text-align: center; padding: 10px; background: none; }
      h3 { font-size: 14px; color: #1a73e8; margin: 0 0 5px 0; }
      p { margin: 3px 0; }
      a { color: #1a73e8; text-decoration: none; }
      a:hover { text-decoration: underline; }
      #mapSnapshot { background: none; width: 600px; height: 400px; margin: 0 auto; }
      #mapSnapshot img { width: 600px; height: 400px; display: block; margin: 0 auto; border: 1px solid #ddd; border-radius: 4px; }
    </style>
  `;

  const reportWindow = window.open("", "Trip Summary", "width=650,height=550");
  reportWindow.document.write(`<html><head><title>Cross Country Trip Summary</title>${styles}</head><body>${summary}</body></html>`);

  captureMapAsPNG(homeCode, destCode, null, dataUrl => {
    if (dataUrl) {
      const img = reportWindow.document.createElement("img");
      img.src = dataUrl;
      reportWindow.document.getElementById("mapSnapshot").appendChild(img);
    } else {
      reportWindow.document.getElementById("mapSnapshot").innerHTML = "<p>Failed to capture map.</p>";
    }
  });

  reportWindow.document.close();
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

function captureMapAsPNG(homeCode, firstCode, secondCode, callback) {
  const mapElement = document.getElementById("map");

  // Close all open popups
  map.closePopup();

  // Define bounds based on selected airports
  const home = airportData[homeCode];
  const first = airportData[firstCode];
  const bounds = [
    [home.lat, home.lon],
    [first.lat, first.lon]
  ];

  if (secondCode && airportData[secondCode]) {
    const second = airportData[secondCode];
    bounds.push([second.lat, second.lon]);
  }

  // Fit map to bounds with more padding for wider view
  map.fitBounds(bounds, {
    padding: [100, 100], // Increased padding for more context
    maxZoom: 8          // Reduced max zoom for broader view
  });

  // Store original styles
  const originalWidth = mapElement.style.width;
  const originalHeight = mapElement.style.height;
  const originalBackground = mapElement.style.backgroundColor;

  // Set map size to match capture size and ensure white background
  mapElement.style.width = "600px";
  mapElement.style.height = "400px";
  mapElement.style.backgroundColor = "#ffffff";

  // Force redraw with new size
  map.invalidateSize();

  setTimeout(() => {
    domtoimage.toPng(mapElement, {
      bgcolor: "#ffffff",
      quality: 1,
      width: 600,        // Fixed width
      height: 400        // Fixed height
    }).then(dataUrl => {
      console.log("Map captured as PNG");
      // Restore original styles
      mapElement.style.width = originalWidth;
      mapElement.style.height = originalHeight;
      mapElement.style.backgroundColor = originalBackground;
      map.invalidateSize(); // Redraw map to original size
      callback(dataUrl);
    }).catch(err => {
      console.error("Error capturing map:", err);
      // Restore original styles on error
      mapElement.style.width = originalWidth;
      mapElement.style.height = originalHeight;
      mapElement.style.backgroundColor = originalBackground;
      map.invalidateSize();
      callback(null);
    });
  }, 300); // Increased delay to ensure zoom and resize settle
}

function showCredits() {
  alert(`🛫 Cross Country Flight Planner

Software Version: ${APP_VERSION}
Last Modified: ${FILE_DATE}
Database Version: ${DATABASE_VERSION}

Built with 💻 + 🛩️  with lots of ❤️🩵
© Copyright 2025 pilot.drchoi@gmail.com. All rights reserved.
`);
}

window.onload = () => {
  initMap();
  loadData();

  const firstMin = document.getElementById("firstLegMin");
  const firstMax = document.getElementById("firstLegMax");
  const firstMinValue = document.getElementById("firstLegMinValue");
  const firstMaxValue = document.getElementById("firstLegMaxValue");
  const firstMinInput = document.getElementById("firstLegMinInput");
  const firstMaxInput = document.getElementById("firstLegMaxInput");

  updateDualSlider(firstMin, firstMax, firstMinValue, firstMaxValue, firstMinInput, firstMaxInput, refreshDistanceCircles);

  firstMin.addEventListener("input", () => updateDualSlider(firstMin, firstMax, firstMinValue, firstMaxValue, firstMinInput, firstMaxInput, refreshDistanceCircles));
  firstMax.addEventListener("input", () => updateDualSlider(firstMin, firstMax, firstMinValue, firstMaxValue, firstMinInput, firstMaxInput, refreshDistanceCircles));
  firstMinInput.addEventListener("input", () => syncSliderFromInput(firstMin, firstMax, firstMinInput, firstMaxInput, refreshDistanceCircles));
  firstMaxInput.addEventListener("input", () => syncSliderFromInput(firstMin, firstMax, firstMinInput, firstMaxInput, refreshDistanceCircles));

  const totalMin = document.getElementById("totalLegMin");
  const totalMax = document.getElementById("totalLegMax");
  const totalMinValue = document.getElementById("totalLegMinValue");
  const totalMaxValue = document.getElementById("totalLegMaxValue");
  const totalMinInput = document.getElementById("totalLegMinInput");
  const totalMaxInput = document.getElementById("totalLegMaxInput");

  updateDualSlider(totalMin, totalMax, totalMinValue, totalMaxValue, totalMinInput, totalMaxInput, drawSecondLegEllipses);

  totalMin.addEventListener("input", () => updateDualSlider(totalMin, totalMax, totalMinValue, totalMaxValue, totalMinInput, totalMaxInput, drawSecondLegEllipses));
  totalMax.addEventListener("input", () => updateDualSlider(totalMin, totalMax, totalMinValue, totalMaxValue, totalMinInput, totalMaxInput, drawSecondLegEllipses));
  totalMinInput.addEventListener("input", () => syncSliderFromInput(totalMin, totalMax, totalMinInput, totalMaxInput, drawSecondLegEllipses));
  totalMaxInput.addEventListener("input", () => syncSliderFromInput(totalMin, totalMax, totalMinInput, totalMaxInput, drawSecondLegEllipses));

  updateTotalLegConstraints();
};

window.addEventListener("DOMContentLoaded", () => {
  const versionSpan = document.querySelector(".versionNumber");
  if (versionSpan) {
    versionSpan.textContent = APP_VERSION; // "v1.3"
    console.log("Version number set to:", APP_VERSION); // Debug
  } else {
    console.error("Could not find .versionNumber element"); // Debug
  }

  document.getElementById("firstLegMin").addEventListener("input", () => {
    updateTotalLegConstraints();
  });
  document.getElementById("firstLegMinInput").addEventListener("change", () => {
    updateTotalLegConstraints();
  });
  document.getElementById("titleHeading").addEventListener("click", async () => {
    await loadDatabaseVersion();
    showCredits();
  });
});


document.querySelectorAll('input[name="tripType"]').forEach(radio => {
  radio.addEventListener("change", resetTripState);
});

