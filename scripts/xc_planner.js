let airportData = {};

let map, marker;
let minCircle, maxCircle;
let maskLayer, minLabel, maxLabel;

let destinationMarkers = [];
let legLine;


async function loadData() {
  try {
//    const response = await fetch("https://raw.githubusercontent.com/choikk/xc_planner/main/json_data/airport_base_info_with_runways_airspace.json");
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
    populateSelect("airportSelect", airports.map(a => `${a.code} - ${a.name}`), airports.map(a => a.code));
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

  let html = `<p>✅ ${results.length} destination(s) found:</p><ul>`;
  results.forEach((r, i) => {
    html += `
      <li>
        <label>
          <input type="radio" name="firstLeg" value="${r.code}" ${i === 0 ? "checked" : ""} onchange="highlightAirport('${r.code}')">
          <strong>${r.code}</strong> (${r.distance} NM) – ${r.name}, ${r.city}, ${r.state} | Airspace ${airportData[r.code].airspace}, Max RWY: ${getMaxRunway(airportData[r.code].runways)} ft
        </label>
      </li>
    `;
  });
  html += "</ul>";

  div.innerHTML = html;

  // 🔁 Clear previous markers
  destinationMarkers.forEach(m => map.removeLayer(m));
  destinationMarkers = [];

  // 🛩 Add markers for each matching airport
  results.forEach(r => {
    const ap = airportData[r.code];
    const color = getAirspaceColor(ap.airspace);

    const marker = L.circleMarker([ap.lat, ap.lon], {
      radius: 6,
      color: color,
      fillColor: color,
      fillOpacity: 0.9,
      weight: 1
    })
    .addTo(map)
    .bindPopup(`
      <strong>${r.code}</strong> (Class ${ap.airspace}) - ${r.distance} NM<br>
      ${ap.airport_name}<br><br>
      <u>Runways</u><br>
      ${ap.runways.map(rwy => `
        ${rwy.rwy_id}: ${rwy.length}' x ${rwy.width}' ${formatSurface(rwy.surface)} (${rwy.condition})
      `).join("<br>")}
    `);

    marker.airportCode = r.code;

    marker.on("click", () => {
      const radio = document.querySelector(`input[type="radio"][name="firstLeg"][value="${r.code}"]`);
      if (radio) {
        radio.checked = true;
        radio.scrollIntoView({ behavior: "smooth", block: "center" });
        highlightAirport(r.code); // also show popup
      }
    });

    destinationMarkers.push(marker);
  });

  // Show second-leg button only if trip type is "two"
  const secondBtn = document.getElementById("secondLegBtn");
  if (tripType === "two") {
    secondBtn.style.display = "none";

    const radios = document.querySelectorAll('input[name="firstLeg"]');
    radios.forEach(radio => {
      radio.addEventListener("change", () => {
        secondBtn.style.display = "inline-block";
      });
    });

    if (radios.length > 0) {
      radios[0].checked = true;
      secondBtn.style.display = "inline-block";
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
        totalDistance: totalDistance.toFixed(1),
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
    
  let html = `<h3>Second Leg Destinations</h3>`;
  html += `<p>✅ ${results.length} second-leg destination(s) found:</p><ul>`;
  results.forEach((r, i) => {
    html += `
      <li>
        <label>
          <input type="radio" name="secondLeg" value="${r.code}" ${i === 0 ? "checked" : ""}>
          <strong>${r.code}</strong> (${r.totalDistance} NM) – ${r.name}, ${r.city}, ${r.state}
        </label>
      </li>
    `; 
  }); 
  html += "</ul>";

  // Optional: Add a "Finalize Selection" button
  html += `<button onclick="finalizeSelection()">Confirm Final Destination</button>`;

  div.innerHTML = html;
}

function syncTotalLegLabel() {
  const min = document.getElementById("totalLegMin").value;
  const max = document.getElementById("totalLegMax").value;
  document.getElementById("totalLegLabel").textContent = `${min} - ${max} NM`;
}

function toggleTotalLeg() {
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

  function showSecondLegButtonIfReady() {
    const results = document.getElementById("resultArea");
    const secondBtn = document.getElementById("secondLegBtn");
    if (results && results.querySelector(".first-destination")) {
      secondBtn.style.display = "inline-block";
    } else {
      secondBtn.style.display = "none";
    }
  }


// ========== Utility ==========
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
    case "G": return "#AAAAAA"; // Light gray
    default: return "#666666";
  }
}

function addMapLegend() {
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
      div.innerHTML +=
        `<i style="background:${color}; width: 12px; height: 12px; display: inline-block; margin-right: 6px;"></i>${labels[c]}<br>`;
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

