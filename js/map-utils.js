// ============================================================
// Free mapping stack: Leaflet + OpenStreetMap tiles + Nominatim
// (place search / geocoding) + OSRM (road routing). No API key,
// no billing account, no signup required for any of these.
//
// Note: Nominatim and the public OSRM demo server are shared,
// rate-limited community services — fine for an internal office
// tool. If usage grows heavy, self-hosting either is the
// no-cost-forever upgrade path.
// ============================================================

function createMap(elementId, center = [20.5937, 78.9629], zoom = 5) {
  const map = L.map(elementId).setView(center, zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);
  return map;
}

// Debounced place search (Nominatim). Returns [{name, lat, lng}]
let _searchTimer = null;
function searchPlaces(query, cb) {
  clearTimeout(_searchTimer);
  if (!query || query.length < 3) { cb([]); return; }
  _searchTimer = setTimeout(async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&limit=6&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { "Accept-Language": "en" } });
      const data = await res.json();
      cb(data.map(d => ({ name: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) })));
    } catch (e) {
      console.error("Place search failed", e);
      cb([]);
    }
  }, 400);
}

// Wires a text input to a live Nominatim autocomplete dropdown.
// onPick(place) fires when the user selects a suggestion.
function attachPlaceAutocomplete(inputEl, listEl, onPick) {
  inputEl.addEventListener("input", () => {
    searchPlaces(inputEl.value, (results) => {
      if (!results.length) { listEl.innerHTML = ""; listEl.style.display = "none"; return; }
      listEl.style.display = "block";
      listEl.innerHTML = results.map((r, i) =>
        `<div data-i="${i}">${r.name}</div>`).join("");
      [...listEl.children].forEach((el, i) => {
        el.addEventListener("click", () => {
          inputEl.value = results[i].name;
          listEl.innerHTML = ""; listEl.style.display = "none";
          onPick(results[i]);
        });
      });
    });
  });
  document.addEventListener("click", (e) => {
    if (!listEl.contains(e.target) && e.target !== inputEl) { listEl.style.display = "none"; }
  });
}

// Fetches a driving route through origin -> via points -> destination using OSRM.
// Returns { geojson, distanceKm, durationMin } or null on failure.
async function fetchRoute(origin, viaPoints, destination) {
  const coords = [origin, ...viaPoints, destination]
    .map(p => `${p.lng},${p.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== "Ok") return null;
    const route = data.routes[0];
    return {
      geojson: route.geometry,
      distanceKm: +(route.distance / 1000).toFixed(1),
      durationMin: Math.round(route.duration / 60)
    };
  } catch (e) {
    console.error("Routing failed", e);
    return null;
  }
}

// Draws a route (and markers) on a Leaflet map from stored journey data.
function drawJourneyRoute(map, journey) {
  const layerGroup = L.layerGroup().addTo(map);
  const pts = [];

  L.marker([journey.origin_lat, journey.origin_lng]).addTo(layerGroup)
    .bindPopup(`<b>Start:</b> ${journey.origin_name}`);
  pts.push([journey.origin_lat, journey.origin_lng]);

  (journey.via_points || []).forEach(v => {
    L.circleMarker([v.lat, v.lng], { radius: 6, color: "#ffb020" }).addTo(layerGroup)
      .bindPopup(`<b>Via:</b> ${v.name}`);
    pts.push([v.lat, v.lng]);
  });

  L.marker([journey.destination_lat, journey.destination_lng]).addTo(layerGroup)
    .bindPopup(`<b>Destination:</b> ${journey.destination_name}`);
  pts.push([journey.destination_lat, journey.destination_lng]);

  if (journey.route_geojson) {
    L.geoJSON(journey.route_geojson, { style: { color: "#ffb020", weight: 4 } }).addTo(layerGroup);
  } else {
    L.polyline(pts, { color: "#ffb020", weight: 3, dashArray: "6 6" }).addTo(layerGroup);
  }

  map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
  return layerGroup;
}

// Simple live ETA text based on start time + estimated duration.
function computeEta(startTimeIso, durationMin) {
  if (!startTimeIso || !durationMin) return null;
  const eta = new Date(new Date(startTimeIso).getTime() + durationMin * 60000);
  const now = new Date();
  if (now > eta) return "Arrived";
  return "ETA " + eta.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
