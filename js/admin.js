let ALL_JOURNEYS_ADMIN = [];

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  const profile = await renderTopbar(session, "admin.html");
  renderFooter();

  if (!profile || !profile.is_admin) {
    document.getElementById("notAdmin").style.display = "block";
    return;
  }
  document.getElementById("adminContent").style.display = "block";

  wireTabs();
  await loadAdminJourneys();
  await loadUsers();
  wirePhotoModalClose();
})();

function wireTabs() {
  document.querySelectorAll(".sort-tabs button[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sort-tabs button[data-tab]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      ["journeys", "photos", "users"].forEach(t => {
        document.getElementById("tab_" + t).style.display = (t === btn.dataset.tab) ? "block" : "none";
      });
      if (btn.dataset.tab === "photos") loadAllPhotos();
    });
  });
}

async function loadAdminJourneys() {
  const { data, error } = await sb
    .from("journeys")
    .select("*, journey_participants(user_id, profiles(full_name))")
    .order("journey_date", { ascending: false });
  if (error) { showToast(error.message, "error"); return; }
  ALL_JOURNEYS_ADMIN = data || [];
  document.getElementById("adminJourneyBody").innerHTML = ALL_JOURNEYS_ADMIN.map(j => `
    <div class="board-row">
      <span class="status-dot ${j.status}"></span>
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
      <div><span class="badge ${j.status}">${j.status}</span></div>
      <div class="pool-avatars">
        ${(j.journey_participants || []).map(p => `<div class="mini-avatar" title="${escapeHtml(p.profiles?.full_name || "")}">${initials(p.profiles?.full_name)}</div>`).join("") || `<span class="hint">Solo</span>`}
      </div>
    </div>`).join("");

  const filter = document.getElementById("photoJourneyFilter");
  filter.innerHTML = `<option value="">All journeys</option>` + ALL_JOURNEYS_ADMIN.map(j =>
    `<option value="${j.id}">${fmtDate(j.journey_date)} · ${escapeHtml(j.booked_person_name)} (${escapeHtml(j.taxi_reg_number)})</option>`).join("");
  filter.addEventListener("change", () => loadAllPhotos(filter.value));
}

function shorten(name) { return (name || "").split(",")[0]; }
function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

async function loadAllPhotos(journeyId = "") {
  const grid = document.getElementById("adminPhotoGrid");
  grid.innerHTML = `<div class="hint">Loading photos…</div>`;
  let query = sb.from("journey_photos").select("*, profiles(full_name), journeys(booked_person_name, journey_date)").order("captured_at", { ascending: false });
  if (journeyId) query = query.eq("journey_id", journeyId);
  const { data, error } = await query;
  if (error) { grid.innerHTML = `<div class="hint">${error.message}</div>`; return; }
  if (!data.length) { grid.innerHTML = `<div class="hint">No photos found.</div>`; return; }

  const urls = await Promise.all(data.map(p => sb.storage.from(PHOTO_BUCKET).createSignedUrl(p.storage_path, 3600)));
  grid.innerHTML = data.map((p, i) =>
    `<img src="${urls[i].data ? urls[i].data.signedUrl : ""}" data-i="${i}" title="${escapeHtml(p.profiles?.full_name || "")}">`).join("");

  grid.querySelectorAll("img").forEach((img, i) => {
    img.addEventListener("click", () => openPhotoModal(data[i], urls[i].data ? urls[i].data.signedUrl : ""));
  });
}

let PHOTO_MODAL_MAP = null;
function wirePhotoModalClose() {
  document.getElementById("photoModal").querySelectorAll("[data-close]").forEach(b =>
    b.addEventListener("click", () => document.getElementById("photoModal").style.display = "none"));
}

function openPhotoModal(photo, url) {
  document.getElementById("photoModalImg").src = url;
  document.getElementById("photoModalMeta").innerHTML = `
    Uploaded by <b>${escapeHtml(photo.profiles?.full_name || "Unknown")}</b> for journey
    <b>${escapeHtml(photo.journeys?.booked_person_name || "")}</b> on ${fmtDate(photo.journeys?.journey_date)}<br>
    Captured ${new Date(photo.captured_at).toLocaleString()}
    ${photo.lat ? `<br>Location: ${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}` : "<br>No location tag available"}
  `;
  document.getElementById("photoModal").style.display = "flex";
  if (photo.lat && photo.lng) {
    setTimeout(() => {
      if (PHOTO_MODAL_MAP) PHOTO_MODAL_MAP.remove();
      PHOTO_MODAL_MAP = createMap("photoModalMap", [photo.lat, photo.lng], 14);
      L.marker([photo.lat, photo.lng]).addTo(PHOTO_MODAL_MAP);
    }, 50);
  }
}

async function loadUsers() {
  const { data, error } = await sb.from("profiles").select("*").order("full_name");
  if (error) { showToast(error.message, "error"); return; }
  document.getElementById("userBody").innerHTML = data.map(u => `
    <div class="board-row" style="grid-template-columns:2fr 2fr 1fr;">
      <span>${escapeHtml(u.full_name)}</span>
      <span class="hint">${escapeHtml(u.email)}</span>
      <span class="badge ${u.is_admin ? "live" : "completed"}">${u.is_admin ? "Admin" : "Member"}</span>
    </div>`).join("");
}
