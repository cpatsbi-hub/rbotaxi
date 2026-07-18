let CURRENT_USER = null;
let CURRENT_PROFILE = null;
let VIA_POINTS = [];
let ORIGIN_PLACE = null, DEST_PLACE = null;
let ROUTE_RESULT = null;
let PREVIEW_MAP = null, PREVIEW_LAYER = null;
let ALL_JOURNEYS = [];

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  CURRENT_USER = session.user;
  CURRENT_PROFILE = await renderTopbar(session, "index.html");
  renderFooter();
  await loadJourneys();
  wireNewJourneyModal();
  wireDetailModal();
  // Refresh every 30s so ETAs / live status stay current
  setInterval(loadJourneys, 30000);
})();

async function loadJourneys() {
  const { data: journeys, error } = await sb
    .from("journeys")
    .select("*, journey_participants(user_id, profiles(full_name))")
    .in("status", ["upcoming", "live"])
    .order("journey_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) { console.error(error); showToast("Could not load journeys", "error"); return; }
  ALL_JOURNEYS = journeys || [];
  renderStats(ALL_JOURNEYS);
  renderBoard(ALL_JOURNEYS);
}

// Live/upcoming is derived from the clock, not a field someone has to toggle:
// a journey is "live" once its start time has passed and "completed" once
// its return time has passed. Only "cancelled" is a manual admin action.
function effectiveStatus(j) {
  if (j.status === "cancelled") return "cancelled";
  const now = new Date();
  if (j.return_time && now > new Date(j.return_time)) return "completed";
  if (j.start_time && now >= new Date(j.start_time)) return "live";
  return "upcoming";
}

function renderStats(journeys) {
  const live = journeys.filter(j => effectiveStatus(j) === "live").length;
  const upcoming = journeys.filter(j => effectiveStatus(j) === "upcoming").length;
  const pooled = journeys.filter(j => (j.journey_participants || []).length > 0).length;
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = journeys.filter(j => j.journey_date === today).length;
  document.getElementById("statRow").innerHTML = `
    <div class="stat-card"><div class="num" style="color:var(--green)">${live}</div><div class="label">Live now</div></div>
    <div class="stat-card"><div class="num" style="color:var(--amber)">${upcoming}</div><div class="label">Upcoming</div></div>
    <div class="stat-card"><div class="num">${todayCount}</div><div class="label">Today</div></div>
    <div class="stat-card"><div class="num">${pooled}</div><div class="label">Car-pooled</div></div>
  `;
}

function renderBoard(journeys) {
  const body = document.getElementById("boardBody");
  const empty = document.getElementById("emptyState");
  if (!journeys.length) { body.innerHTML = ""; empty.style.display = "block"; return; }
  empty.style.display = "none";

  body.innerHTML = journeys.map(j => {
    const participants = j.journey_participants || [];
    const alreadyIn = participants.some(p => p.user_id === CURRENT_USER.id) || j.created_by === CURRENT_USER.id;
    const status = effectiveStatus(j);
    const eta = status === "live" ? computeEta(j.start_time, j.duration_min) : null;
    return `
      <div class="board-row" data-id="${j.id}">
        <span class="status-dot ${status}"></span>
        <div class="route-cell">
          <div class="from-to">${escapeHtml(j.booked_person_name)} · ${escapeHtml(shorten(j.origin_name))} → ${escapeHtml(shorten(j.destination_name))}</div>
          <div class="via">${(j.via_points || []).length ? "via " + j.via_points.map(v => shorten(v.name)).join(", ") : ""}</div>
        </div>
        <div>
          <div class="reg">${escapeHtml(j.taxi_reg_number)}</div>
          <div class="hint" style="margin-top:4px;">${escapeHtml(j.driver_name)}</div>
        </div>
        <div class="time-cell">${fmtDate(j.journey_date)}</div>
        <div class="time-cell">${fmtTime(j.start_time)} – ${fmtTime(j.return_time)}</div>
        <div class="eta-badge">${eta || (j.duration_min ? j.duration_min + " min" : "—")}</div>
        <div class="pool-avatars">
          ${participants.slice(0, 3).map(p => `<div class="mini-avatar" title="${escapeHtml(p.profiles?.full_name || "")}">${initials(p.profiles?.full_name)}</div>`).join("")}
          ${!alreadyIn ? `<div class="join-plus" data-join="${j.id}" title="Join for car-pooling">+</div>` : ""}
        </div>
      </div>`;
  }).join("");

  body.querySelectorAll(".join-plus").forEach(el => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      await joinJourney(el.dataset.join);
    });
  });
  body.querySelectorAll(".board-row").forEach(el => {
    el.addEventListener("click", () => openDetail(el.dataset.id));
  });
}

function shorten(name) { return (name || "").split(",")[0]; }
function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

async function joinJourney(journeyId) {
  const { error } = await sb.from("journey_participants").insert({ journey_id: journeyId, user_id: CURRENT_USER.id });
  if (error) { showToast(error.message, "error"); return; }
  showToast("Joined the journey for car-pooling", "success");
  await loadJourneys();
}

// ---------------- New journey modal ----------------
function wireNewJourneyModal() {
  const modal = document.getElementById("newJourneyModal");
  document.getElementById("newJourneyBtn").addEventListener("click", () => {
    resetJourneyForm();
    modal.style.display = "flex";
    setTimeout(() => {
      if (!PREVIEW_MAP) PREVIEW_MAP = createMap("routePreview", [20.5937, 78.9629], 4);
    }, 50);
  });
  modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.style.display = "none"));

  attachPlaceAutocomplete(document.getElementById("f_origin"), document.getElementById("l_origin"), (p) => {
    ORIGIN_PLACE = p; refreshRoutePreview();
  });
  attachPlaceAutocomplete(document.getElementById("f_dest"), document.getElementById("l_dest"), (p) => {
    DEST_PLACE = p; refreshRoutePreview();
  });
  attachPlaceAutocomplete(document.getElementById("f_via"), document.getElementById("l_via"), (p) => {
    VIA_POINTS.push(p);
    document.getElementById("f_via").value = "";
    renderViaChips();
    refreshRoutePreview();
  });

  document.getElementById("saveJourneyBtn").addEventListener("click", saveJourney);
}

function resetJourneyForm() {
  ["f_person", "f_origin", "f_dest", "f_via", "f_reg", "f_driver", "f_date", "f_start", "f_return"].forEach(id => document.getElementById(id).value = "");
  VIA_POINTS = []; ORIGIN_PLACE = null; DEST_PLACE = null; ROUTE_RESULT = null;
  renderViaChips();
  document.getElementById("routeInfo").textContent = "";
  if (PREVIEW_LAYER) { PREVIEW_LAYER.clearLayers(); }
}

function renderViaChips() {
  document.getElementById("viaChips").innerHTML = VIA_POINTS.map((v, i) =>
    `<span class="badge upcoming" style="cursor:pointer;" data-i="${i}">${shorten(v.name)} &times;</span>`).join("");
  document.querySelectorAll("#viaChips span").forEach(el => {
    el.addEventListener("click", () => {
      VIA_POINTS.splice(+el.dataset.i, 1);
      renderViaChips();
      refreshRoutePreview();
    });
  });
}

async function refreshRoutePreview() {
  if (!ORIGIN_PLACE || !DEST_PLACE) return;
  const info = document.getElementById("routeInfo");
  info.textContent = "Calculating route...";
  ROUTE_RESULT = await fetchRoute(ORIGIN_PLACE, VIA_POINTS, DEST_PLACE);
  if (!PREVIEW_LAYER) PREVIEW_LAYER = L.layerGroup().addTo(PREVIEW_MAP);
  PREVIEW_LAYER.clearLayers();
  const pts = [ORIGIN_PLACE, ...VIA_POINTS, DEST_PLACE].map(p => [p.lat, p.lng]);
  L.marker([ORIGIN_PLACE.lat, ORIGIN_PLACE.lng]).addTo(PREVIEW_LAYER);
  L.marker([DEST_PLACE.lat, DEST_PLACE.lng]).addTo(PREVIEW_LAYER);
  VIA_POINTS.forEach(v => L.circleMarker([v.lat, v.lng], { radius: 5, color: "#ffb020" }).addTo(PREVIEW_LAYER));
  if (ROUTE_RESULT) {
    L.geoJSON(ROUTE_RESULT.geojson, { style: { color: "#ffb020", weight: 4 } }).addTo(PREVIEW_LAYER);
    info.textContent = `Distance ${ROUTE_RESULT.distanceKm} km · approx. ${ROUTE_RESULT.durationMin} min drive`;
  } else {
    L.polyline(pts, { color: "#ffb020", dashArray: "6 6" }).addTo(PREVIEW_LAYER);
    info.textContent = "Could not fetch a precise route; showing a straight line.";
  }
  PREVIEW_MAP.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
}

async function saveJourney() {
  const person = document.getElementById("f_person").value.trim();
  const date = document.getElementById("f_date").value;
  const reg = document.getElementById("f_reg").value.trim();
  const driver = document.getElementById("f_driver").value.trim();
  const startT = document.getElementById("f_start").value;
  const returnT = document.getElementById("f_return").value;

  if (!person || !ORIGIN_PLACE || !DEST_PLACE || !date || !reg || !driver || !startT || !returnT) {
    showToast("Please fill in every field — start and return time are mandatory.", "error");
    return;
  }

  const payload = {
    created_by: CURRENT_USER.id,
    booked_person_name: person,
    origin_name: ORIGIN_PLACE.name, origin_lat: ORIGIN_PLACE.lat, origin_lng: ORIGIN_PLACE.lng,
    destination_name: DEST_PLACE.name, destination_lat: DEST_PLACE.lat, destination_lng: DEST_PLACE.lng,
    via_points: VIA_POINTS,
    route_geojson: ROUTE_RESULT ? ROUTE_RESULT.geojson : null,
    distance_km: ROUTE_RESULT ? ROUTE_RESULT.distanceKm : null,
    duration_min: ROUTE_RESULT ? ROUTE_RESULT.durationMin : null,
    journey_date: date,
    start_time: `${date}T${startT}:00`,
    return_time: `${date}T${returnT}:00`,
    taxi_reg_number: reg,
    driver_name: driver,
    status: "upcoming"
  };

  const { error } = await sb.from("journeys").insert(payload);
  if (error) { showToast(error.message, "error"); return; }
  showToast("Journey booked", "success");
  document.getElementById("newJourneyModal").style.display = "none";
  await loadJourneys();
}

// ---------------- Detail modal ----------------
let DETAIL_MAP = null;
function wireDetailModal() {
  document.getElementById("detailModal").querySelectorAll("[data-close]").forEach(b =>
    b.addEventListener("click", () => document.getElementById("detailModal").style.display = "none"));
}

async function openDetail(journeyId) {
  const j = ALL_JOURNEYS.find(x => x.id === journeyId);
  if (!j) return;
  document.getElementById("d_title").textContent = `${j.booked_person_name} — ${shorten(j.origin_name)} → ${shorten(j.destination_name)}`;
  document.getElementById("d_reg").textContent = j.taxi_reg_number;
  document.getElementById("d_driver").textContent = j.driver_name;
  document.getElementById("d_start").textContent = fmtTime(j.start_time) + " on " + fmtDate(j.journey_date);
  document.getElementById("d_return").textContent = fmtTime(j.return_time);
  document.getElementById("d_dist").textContent = j.distance_km ? j.distance_km + " km" : "—";
  document.getElementById("d_eta").textContent = computeEta(j.start_time, j.duration_min) || (j.duration_min ? j.duration_min + " min drive" : "—");

  const participants = j.journey_participants || [];
  document.getElementById("d_participants").innerHTML = participants.length
    ? participants.map(p => `<span class="badge upcoming">${escapeHtml(p.profiles?.full_name || "Traveller")}</span>`).join("")
    : `<span class="hint">No one has joined yet — be the first to car-pool.</span>`;

  const alreadyIn = participants.some(p => p.user_id === CURRENT_USER.id) || j.created_by === CURRENT_USER.id;
  const joinBtn = document.getElementById("joinBtn");
  joinBtn.style.display = alreadyIn ? "none" : "inline-flex";
  joinBtn.onclick = async () => { await joinJourney(j.id); document.getElementById("detailModal").style.display = "none"; };

  document.getElementById("detailModal").style.display = "flex";
  setTimeout(() => {
    if (DETAIL_MAP) { DETAIL_MAP.remove(); }
    DETAIL_MAP = createMap("detailMap", [j.origin_lat, j.origin_lng], 6);
    drawJourneyRoute(DETAIL_MAP, j);
  }, 50);

  await loadPhotos(j.id);
  document.getElementById("photoInput").onchange = (e) => uploadPhoto(j.id, e.target.files[0]);
}

async function loadPhotos(journeyId) {
  const grid = document.getElementById("d_photos");
  grid.innerHTML = `<div class="hint">Loading photos…</div>`;
  const { data, error } = await sb.from("journey_photos").select("*").eq("journey_id", journeyId).order("captured_at", { ascending: false });
  if (error || !data || !data.length) { grid.innerHTML = `<div class="hint">No photos uploaded yet.</div>`; return; }

  const urls = await Promise.all(data.map(p => sb.storage.from(PHOTO_BUCKET).createSignedUrl(p.storage_path, 3600)));
  grid.innerHTML = data.map((p, i) => {
    const url = urls[i].data ? urls[i].data.signedUrl : "";
    return `<img src="${url}" title="Captured ${new Date(p.captured_at).toLocaleString()}">`;
  }).join("");
}

async function uploadPhoto(journeyId, file) {
  if (!file) return;
  showToast("Getting your location and uploading...");
  let lat = null, lng = null;
  try {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 }));
    lat = pos.coords.latitude; lng = pos.coords.longitude;
  } catch (e) {
    console.warn("Geolocation unavailable, uploading without coordinates.");
  }

  const path = `${journeyId}/${CURRENT_USER.id}/${Date.now()}-${file.name}`;
  const { error: upErr } = await sb.storage.from(PHOTO_BUCKET).upload(path, file, { upsert: false });
  if (upErr) { showToast(upErr.message, "error"); return; }

  const { error: dbErr } = await sb.from("journey_photos").insert({
    journey_id: journeyId, user_id: CURRENT_USER.id, storage_path: path, lat, lng
  });
  if (dbErr) { showToast(dbErr.message, "error"); return; }

  showToast("Photo uploaded", "success");
  await loadPhotos(journeyId);
}
