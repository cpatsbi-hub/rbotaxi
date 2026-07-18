let CURRENT_USER = null;
let PAST_JOURNEYS = [];
let SORT_DIR = "recent";
let CAL_DATE = new Date();

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  CURRENT_USER = session.user;
  await renderTopbar(session, "archive.html");
  renderFooter();
  await loadPast();
  wireViewToggle();
  wireSortToggle();
  wireCalendarNav();
  wireDetailModal();
})();

async function loadPast() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from("journeys")
    .select("*, journey_participants(user_id, profiles(full_name))")
    .or(`status.eq.completed,status.eq.cancelled,journey_date.lt.${today}`)
    .order("journey_date", { ascending: false });
  if (error) { console.error(error); showToast("Could not load archive", "error"); return; }
  PAST_JOURNEYS = data || [];
  renderList();
  renderCalendar();
}

function wireViewToggle() {
  document.querySelectorAll(".sort-tabs button[data-view]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sort-tabs button[data-view]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      document.getElementById("listView").style.display = view === "list" ? "block" : "none";
      document.getElementById("calendarView").style.display = view === "calendar" ? "block" : "none";
    });
  });
}

function wireSortToggle() {
  document.querySelectorAll(".sort-tabs button[data-sort]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sort-tabs button[data-sort]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      SORT_DIR = btn.dataset.sort;
      renderList();
    });
  });
}

function renderList() {
  const rows = [...PAST_JOURNEYS].sort((a, b) =>
    SORT_DIR === "recent" ? b.journey_date.localeCompare(a.journey_date) : a.journey_date.localeCompare(b.journey_date));
  const body = document.getElementById("listBody");
  const empty = document.getElementById("listEmpty");
  if (!rows.length) { body.innerHTML = ""; empty.style.display = "block"; return; }
  empty.style.display = "none";
  body.innerHTML = rows.map(j => rowHtml(j)).join("");
  attachRowHandlers(body);
}

function rowHtml(j) {
  const participants = j.journey_participants || [];
  return `
    <div class="board-row" data-id="${j.id}">
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
      <div class="time-cell">${j.distance_km ? j.distance_km + " km" : "—"}</div>
      <div class="pool-avatars">
        ${participants.slice(0, 4).map(p => `<div class="mini-avatar" title="${escapeHtml(p.profiles?.full_name || "")}">${initials(p.profiles?.full_name)}</div>`).join("") || `<span class="hint">Solo</span>`}
      </div>
    </div>`;
}

function attachRowHandlers(container) {
  container.querySelectorAll(".board-row").forEach(el => el.addEventListener("click", () => openDetail(el.dataset.id)));
}

function shorten(name) { return (name || "").split(",")[0]; }
function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ---------------- Calendar ----------------
function wireCalendarNav() {
  document.getElementById("prevMonth").addEventListener("click", () => { CAL_DATE.setMonth(CAL_DATE.getMonth() - 1); renderCalendar(); });
  document.getElementById("nextMonth").addEventListener("click", () => { CAL_DATE.setMonth(CAL_DATE.getMonth() + 1); renderCalendar(); });
}

function renderCalendar() {
  const y = CAL_DATE.getFullYear(), m = CAL_DATE.getMonth();
  document.getElementById("monthLabel").textContent = CAL_DATE.toLocaleDateString([], { month: "long", year: "numeric" });
  const firstDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const journeysByDate = {};
  PAST_JOURNEYS.forEach(j => { (journeysByDate[j.journey_date] ||= []).push(j); });

  const grid = document.getElementById("calendarGrid");
  let html = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < firstDow; i++) html += `<div class="day muted"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const has = journeysByDate[dateStr];
    html += `<div class="day ${has ? "has-journey" : ""}" data-date="${dateStr}">${d}</div>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll(".day[data-date]").forEach(el => {
    el.addEventListener("click", () => {
      grid.querySelectorAll(".day").forEach(d => d.classList.remove("selected"));
      el.classList.add("selected");
      showDayResults(el.dataset.date, journeysByDate[el.dataset.date] || []);
    });
  });
}

function showDayResults(dateStr, journeys) {
  const el = document.getElementById("calendarDayResults");
  if (!journeys.length) {
    el.innerHTML = `<div class="empty-state"><div class="display">No journeys on ${fmtDate(dateStr)}</div></div>`;
    return;
  }
  el.innerHTML = `<div class="board"><div class="board-row-head">
      <span></span><span>Booked for / Route</span><span>Reg. no. / Driver</span><span>Date</span><span>Start / Return</span><span>Distance</span><span>Pool</span>
    </div>${journeys.map(rowHtml).join("")}</div>`;
  attachRowHandlers(el);
}

// ---------------- Detail modal (shared look with dashboard) ----------------
let DETAIL_MAP = null;
function wireDetailModal() {
  document.getElementById("detailModal").querySelectorAll("[data-close]").forEach(b =>
    b.addEventListener("click", () => document.getElementById("detailModal").style.display = "none"));
}

async function openDetail(journeyId) {
  const j = PAST_JOURNEYS.find(x => x.id === journeyId);
  if (!j) return;
  document.getElementById("d_title").textContent = `${j.booked_person_name} — ${shorten(j.origin_name)} → ${shorten(j.destination_name)}`;
  document.getElementById("d_reg").textContent = j.taxi_reg_number;
  document.getElementById("d_driver").textContent = j.driver_name;
  document.getElementById("d_start").textContent = fmtTime(j.start_time) + " on " + fmtDate(j.journey_date);
  document.getElementById("d_return").textContent = fmtTime(j.return_time);
  document.getElementById("d_dist").textContent = j.distance_km ? j.distance_km + " km" : "—";
  document.getElementById("d_eta").textContent = j.status === "cancelled" ? "Cancelled" : "Completed";

  const participants = j.journey_participants || [];
  document.getElementById("d_participants").innerHTML = participants.length
    ? participants.map(p => `<span class="badge upcoming">${escapeHtml(p.profiles?.full_name || "Traveller")}</span>`).join("")
    : `<span class="hint">Travelled solo.</span>`;

  document.getElementById("detailModal").style.display = "flex";
  setTimeout(() => {
    if (DETAIL_MAP) DETAIL_MAP.remove();
    DETAIL_MAP = createMap("detailMap", [j.origin_lat, j.origin_lng], 6);
    drawJourneyRoute(DETAIL_MAP, j);
  }, 50);

  const grid = document.getElementById("d_photos");
  grid.innerHTML = `<div class="hint">Loading photos…</div>`;
  const { data } = await sb.from("journey_photos").select("*").eq("journey_id", j.id).order("captured_at", { ascending: false });
  if (!data || !data.length) { grid.innerHTML = `<div class="hint">No photos were uploaded for this journey.</div>`; return; }
  const urls = await Promise.all(data.map(p => sb.storage.from(PHOTO_BUCKET).createSignedUrl(p.storage_path, 3600)));
  grid.innerHTML = data.map((p, i) => `<img src="${urls[i].data ? urls[i].data.signedUrl : ""}" title="Captured ${new Date(p.captured_at).toLocaleString()}">`).join("");
}
