const APP_VERSION = "v1.2.2"; // or whatever you like
const FILE_DATE = new Date().toISOString().split("T")[0];

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

  // ✅ Thick green dashed circle (min distance)
  minCircle = L.circle(latlng, {
    radius: minMeters,
    color: "green",
    fill: false,
    weight: 3,
    dashArray: "6 6"
  }).addTo(map);

  // ✅ Thick red dashed circle (max distance)
  maxCircle = L.circle(latlng, {
    radius: maxMeters,
    color: "red",
    fill: false,
    weight: 3,
    dashArray: "6 6"
  }).addTo(map);

  // ✅ Min distance label at center
  const latOffset1 = (minMeters / 1852) / 60;
  minLabel = L.marker([latlng.lat + latOffset1, latlng.lng], {
    icon: L.divIcon({
      className: 'circle-label',
      html: `<div style="color: green; font-size: 14px; font-weight: bold;">${minNM} NM</div>`,
      iconAnchor: [0, 0]
    })
  }).addTo(map);

  // ✅ Max distance label at top edge
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
  const min = document.getElementById("firstLegMin").value;
  const max = document.getElementById("firstLegMax").value;
  document.getElementById("firstLegMinInput").value = min;
  document.getElementById("firstLegMaxInput").value = max;
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

function syncFirstLegMinFromInput() {
  let min = parseInt(document.getElementById("firstLegMinInput").value);
  let max = parseInt(document.getElementById("firstLegMaxInput").value);

  min = Math.max(1, Math.min(min || 1, 500));
  max = Math.max(1, Math.min(max || 1, 500));

  if (min > max) {
    max = min;
  }

  document.getElementById("firstLegMin").value = min;
  document.getElementById("firstLegMax").value = max;
  document.getElementById("firstLegMinInput").value = min;
  document.getElementById("firstLegMaxInput").value = max;

  updateFirstLegLabel();
}

function syncFirstLegMaxFromInput() {
  let min = parseInt(document.getElementById("firstLegMinInput").value);
  let max = parseInt(document.getElementById("firstLegMaxInput").value);

  min = Math.max(1, Math.min(min || 1, 500));
  max = Math.max(1, Math.min(max || 1, 500));

  if (max < min) {
    min = max;
  }

  document.getElementById("firstLegMin").value = min;
  document.getElementById("firstLegMax").value = max;
  document.getElementById("firstLegMinInput").value = min;
  document.getElementById("firstLegMaxInput").value = max;

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

   document.getElementById("firstLegLabel").textContent = `${minVal} - ${maxVal} NM`;
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

  document.getElementById("totalLegLabel").textContent = `${min} - ${max} NM`;
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

  displayResults(results);
}

function displayResults(results) {
  const div = document.getElementById("resultArea");
  const tripType = document.querySelector('input[name="tripType"]:checked').value;

  if (results.length === 0) {
    div.innerHTML = "<p>🚫 No matching destination airports found.</p>";
    return;
  }

  results.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

  // Build the HTML for the results list
  let html = `<p>✅ ${results.length} destination(s) found:</p><ul class="result-list">`;
  results.forEach((r, i) => {
    html += `
      <li>
        <label style="font-size: 1.0em;">
          <input type="radio" name="firstLeg" value="${r.code}" ${i === 0 ? "checked" : ""}>
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

    // Bind popup to each marker
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

    // Add click handler to sync with radio button
    marker.on("click", () => {
      const radio = document.querySelector(`input[name="firstLeg"][value="${r.code}"]`);
      if (radio) {
        radio.checked = true;
        highlightAirport(r.code);
        drawSecondLegEllipses();
        findSecondLeg();
        radio.scrollIntoView({ behavior: "smooth", block: "center" });
        marker.openPopup(); // Ensure popup opens on click
      }
    });
  });

  // Add change listener for radio buttons
  const radios = document.querySelectorAll('input[name="firstLeg"]');
  radios.forEach(radio => {
    radio.addEventListener("change", () => {
      const code = radio.value;
      highlightAirport(code);      // Update map for first leg
      drawSecondLegEllipses();     // Draw ellipses for second leg
      findSecondLeg();             // Find second-leg options
    });
  });

  // Initial setup for two-destination mode
  if (tripType === "two" && radios.length > 0) {
    const firstRadio = radios[0];
    firstRadio.checked = true; // Ensure first is selected
    highlightAirport(firstRadio.value);
    drawSecondLegEllipses();
    findSecondLeg();
  }

// Show second-leg button only if trip type is "two"
  const secondBtn = document.getElementById("secondLegBtn");
  if (secondBtn) { // Check if the button exists in the DOM
    if (tripType === "two") {
      secondBtn.style.display = "inline-block";
      secondBtn.textContent = "Find Second Leg"; // Optional: set button text
      secondBtn.onclick = () => {
        resetSecondLeg();  // Reset only second-leg state
        findSecondLeg();   // Rerun second-leg search
        drawSecondLegEllipses();

        const firstLegCode = document.querySelector('input[name="firstLeg"]:checked')?.value;
        highlightAirport(firstLegCode);
      };
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

  displaySecondLegResults(secondLegResults);
}

function displaySecondLegResults(results) {
  const div = document.getElementById("secondLegArea");

  if (results.length === 0) {
    div.innerHTML = "<p>🚫 No second-leg destinations found.</p>";
    return;
  }

  // ✅ Sort by distance
  results.sort((a, b) => a.totalDistance - b.totalDistance);

  let html = `<h3>Second Leg Destinations (Sort by total trip distance)</h3>`;
  html += `<p>✅ ${results.length} second-leg destination(s) found:</p><ul class="result-list">`;
  results.forEach((r, i) => {
    html += `
      <li>
        <label style="font-size: 1.0em;">
          <input type="radio" name="secondLeg" value="${r.code}" onchange="drawTriangle('${r.fromCode}', '${r.code}', '${r.homeCode}')">
          <strong>${r.code}</strong> (${r.totalDistance} NM) – ${r.name}, ${r.city}, ${r.state}
        </label>
      </li>
    `;
  });
  html += "</ul>";

//  html += `<button onclick="finalizeSelection()">Confirm Final Destination</button>`;
  div.innerHTML = html;

  // 🔁 Clear previous second-leg markers
  if (secondLegMarkers) {
    secondLegMarkers.forEach(m => map.removeLayer(m));
    secondLegMarkers = [];
  }

  const firstCode = document.querySelector('input[name="firstLeg"]:checked')?.value;
  const homeCode = document.getElementById("airportSelect").value;
  const firstAp = airportData[firstCode];
  const homeAp = airportData[homeCode];

  // 🟪 Add square markers
  results.forEach(r => {
    const ap = airportData[r.code];
    const color = getAirspaceColor(ap.airspace);

    const latOffset = 0.025;
    const lonOffset = latOffset / Math.cos(ap.lat * Math.PI / 180);
    
    const marker = L.marker([ap.lat, ap.lon], {
      icon: squareMarker(color) // or triangleIcon(color)
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
    const tripType = document.querySelector('input[name="tripType"]:checked')?.value;
    const selectedFirst = document.querySelector('input[name="firstLeg"]:checked')?.value;
    const selectedSecond = document.querySelector('input[name="secondLeg"]:checked')?.value;

    const isFirst = destinationMarkers.includes(marker);
    const isSecond = secondLegMarkers.includes(marker);

    if (tripType === "two" && isFirst && isSecond) {
    // 🌀 Shared airport toggle logic
      if (selectedSecond === r.code) {
      // 🔁 Promote to first destination
        const radio = document.querySelector(`input[name="firstLeg"][value="${r.code}"]`);
        if (radio) {
          radio.checked = true;
          radio.scrollIntoView({ behavior: "smooth", block: "center" });
          highlightAirport(r.code);
          findSecondLeg(); // Refresh second-leg list
        }
      } else {
      // 🎯 Set as second-leg
        const radio = document.querySelector(`input[name="secondLeg"][value="${r.code}"]`);
        if (radio) {
          radio.checked = true;
          radio.scrollIntoView({ behavior: "smooth", block: "center" });
          drawTriangle(selectedFirst, r.code, document.getElementById("airportSelect").value);
        }
      }
      return;
    }

  // ✅ Regular first-leg or second-leg behavior
    if (tripType === "two" && isFirst) {
      const radio = document.querySelector(`input[name="firstLeg"][value="${r.code}"]`);
      if (radio) {
        radio.checked = true;
        radio.scrollIntoView({ behavior: "smooth", block: "center" });
        highlightAirport(r.code);
        findSecondLeg();
      }
      return;
    }

    if (tripType === "two" && isSecond) {
      const radio = document.querySelector(`input[name="secondLeg"][value="${r.code}"]`);
      if (radio) {
        radio.checked = true;
        radio.scrollIntoView({ behavior: "smooth", block: "center" });
        drawTriangle(selectedFirst, r.code, document.getElementById("airportSelect").value);
      }
      return;
    }

  // One destination mode
    if (tripType === "one") {
      const radio = document.querySelector(`input[name="firstLeg"][value="${r.code}"]`);
      if (radio) {
        radio.checked = true;
        radio.scrollIntoView({ behavior: "smooth", block: "center" });
        highlightAirport(r.code);
      }
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
  }

  if (!first || !second || !home) {
    console.warn("One or more airports are missing:", { firstCode, secondCode, homeCode });
    return;
  }

  // Clear previous lines
  triangleLines.forEach(line => map.removeLayer(line));
  triangleLines = [];

  // Define all 3 legs
  const legs = [
    [home, first],
    [first, second],
    [second, home]
  ];

  // Draw each leg
  legs.forEach(([from, to]) => {
    const line = L.polyline([
      [from.lat, from.lon],
      [to.lat, to.lon]
    ], {
      color: "#FF00FF",       // Magenta
      weight: 5,
//      dashArray: "5, 5",
      opacity: 0.8
    }).addTo(map);

    triangleLines.push(line);
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
  document.getElementById("totalLegLabel").textContent = `${min} - ${max} NM`;
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

  // Open popup and zoom
  marker.openPopup();
  map.setView(marker.getLatLng(), map.getZoom());

  const ap = airportData[code];
  const homeCode = document.getElementById("airportSelect").value;
  const homeAp = airportData[homeCode];

  if (!ap || !homeAp) return;

  // Remove existing leg line if any
  if (legLine) map.removeLayer(legLine);
  if (triangleLines && triangleLines.length > 0) {
    triangleLines.forEach(line => map.removeLayer(line));
    triangleLines = [];
  }

  // Draw a straight magenta line
  legLine = L.polyline([[homeAp.lat, homeAp.lon], [ap.lat, ap.lon]], {
    color: "#FF00FF", // Magenta
    weight: 5,
//    dashArray: "5, 5",
    opacity: 0.8
  }).addTo(map);
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
  // 🧹 Remove first-leg line
  if (legLine) {
    map.removeLayer(legLine);
    legLine = null;
  }

  // 🧹 Remove triangle lines
  if (triangleLines && triangleLines.length > 0) {
    triangleLines.forEach(line => map.removeLayer(line));
    triangleLines = [];
  }

// 🧹 Remove destination markers
if (Array.isArray(destinationMarkers)) {
  let count = destinationMarkers.length;
  destinationMarkers.forEach(marker => {
    if (map.hasLayer(marker)) map.removeLayer(marker);
  });
  destinationMarkers = [];
  console.log("✅ Cleared", count, "first-leg markers");
}

// 🧹 Remove second-leg markers
if (Array.isArray(secondLegMarkers)) {
  let count = secondLegMarkers.length;
  secondLegMarkers.forEach(marker => {
    if (map.hasLayer(marker)) map.removeLayer(marker);
  });
  secondLegMarkers = [];
  console.log("✅ Cleared", count, "second-leg markers");
}

  // 🧹 Remove second-leg ring (legacy) or ellipses
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

  // 🧹 Clear results and UI
  document.getElementById("resultArea").innerHTML = `<p>No destinations yet. Click "Find Destinations" to search.</p>`;
  document.getElementById("secondLegArea").innerHTML = "";

  // 🧹 Hide second-leg button
  document.getElementById("secondLegBtn").style.display = "none";

  // 🧭 Recenter the map to home base
  const homeCode = document.getElementById("airportSelect").value;
  const homeAp = airportData[homeCode];
  if (homeAp) {
    map.setView([homeAp.lat, homeAp.lon], 8); // Adjust zoom if needed
  }

  console.log("✅ Trip state fully reset.");
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

  const summary = `
🛫 Airports

Departure:
  Airport ID: ${homeCode}
  Airspace  : Class ${home.airspace}
  Name      : ${home.airport_name}
  Runways   :
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

  ${homeCode} ➝ ${firstCode} : ${leg1} NM
  ${firstCode} ➝ ${secondCode} : ${leg2} NM
  ${secondCode} ➝ ${homeCode} : ${leg3} NM

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

  const summary = `
🛫 Airports

Departure:
  Airport ID: ${homeCode}
  Airspace  : Class ${home.airspace}
  Name      : ${home.airport_name}
  Runways   :
${getRunways(home)}

Destination :
  Airport ID: ${firstCode}
  Airspace  : Class ${dest.airspace}
  Name: ${dest.airport_name}
  Runways   :
${getRunways(dest)}

📏 Trip Summary

  ${homeCode} ➝ ${firstCode} : ${legOut} NM
  ${firstCode} ➝ ${homeCode} : ${legBack} NM

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
  if (window.secondLegMarkers) {
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

Version: ${APP_VERSION}
Last Updated: ${FILE_DATE}
© 2025 pilot.drchoi@gmail.com
Built with 💻 + ✈️
All rights reserved.`);
}


window.onload = () => {
  initMap();
  loadData();
  updateFirstLegLabel();
  syncTotalLegLabel();
  // Update map circles when sliders or inputs change
  document.getElementById("firstLegMin").addEventListener("input", refreshDistanceCircles);
  document.getElementById("firstLegMax").addEventListener("input", refreshDistanceCircles);
  document.getElementById("firstLegMinInput").addEventListener("input", refreshDistanceCircles);
  document.getElementById("firstLegMaxInput").addEventListener("input", refreshDistanceCircles);

};

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("firstLegMin").addEventListener("input", updateTotalLegMinFromFirstLeg);
  document.getElementById("firstLegMinInput").addEventListener("change", updateTotalLegMinFromFirstLeg);
});
document.querySelectorAll('input[name="tripType"]').forEach(radio => {
  radio.addEventListener("change", resetTripState);
});

["totalLegMin", "totalLegMax", "totalLegMinInput", "totalLegMaxInput"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", () => {
    drawSecondLegEllipses();
  });
});

