// ============================================================
// PASTE YOUR CLOUDFLARE WORKER URL HERE — this is the proxy that
// keeps your real Hashtrace authKey private (see
// cloudflare-worker-hashtrace-proxy.js for how to deploy it).
// It looks like: https://hashtrace-proxy.YOUR-SUBDOMAIN.workers.dev
// ============================================================
const HASHTRACE_PROXY_URL = "https://hashtrace-proxy.cpatsbi.workers.dev/";

let FLEET_MAP = null;
let FLEET_MARKERS = {}; // taxi id -> L.marker

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  await renderTopbar(session, "live-map.html");
  renderFooter();

  if (HASHTRACE_PROXY_URL.includes("REPLACE-ME")) {
    document.getElementById("noProxyState").style.display = "block";
    document.getElementById("mapWrap").style.display = "none";
    return;
  }

  FLEET_MAP = createMap("fleetMap", [10.8, 76.2], 8); // rough Kerala-area default center
  await refreshFleet();
  setInterval(refreshFleet, 20000); // refresh every 20s
})();

async function refreshFleet() {
  const { data: taxis, error } = await sb.from("taxis").select("*").not("gps_imei", "is", null);
  if (error) { showToast("Could not load vehicle list", "error"); return; }

  if (!taxis.length) {
    document.getElementById("emptyState").style.display = "block";
    document.getElementById("mapWrap").style.display = "none";
    document.getElementById("fleetBody").innerHTML = "";
    return;
  }
  document.getElementById("emptyState").style.display = "none";
  document.getElementById("mapWrap").style.display = "block";

  let livePositions = [];
  try {
    const res = await fetch(HASHTRACE_PROXY_URL);
    livePositions = await res.json();
    if (!Array.isArray(livePositions)) throw new Error(livePositions.error || "Unexpected response");
  } catch (e) {
    showToast("Could not reach live tracking: " + e.message, "error");
    return;
  }

  const byImei = {};
  livePositions.forEach(p => { byImei[p.Imei] = p; });

  const rows = [];
  const bounds = [];

  taxis.forEach(taxi => {
    const pos = byImei[taxi.gps_imei];
    if (!pos) {
      rows.push(offlineRow(taxi));
      return;
    }
    const lat = parseFloat(pos.Lat);
    const lng = parseFloat(pos.Lon);
    bounds.push([lat, lng]);

    updateMarker(taxi, pos, lat, lng);
    rows.push(liveRow(taxi, pos));
  });

  document.getElementById("fleetBody").innerHTML = rows.join("");
  document.getElementById("lastUpdated").textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  if (bounds.length) FLEET_MAP.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
}

function updateMarker(taxi, pos, lat, lng) {
  const ignOn = pos.Ign === true || pos.Ign === "true";
  const icon = L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${ignOn ? "#34d399" : "#8892a0"};border:2px solid #12161d;box-shadow:0 0 0 2px ${ignOn ? "#34d399" : "#8892a0"}66;"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  if (FLEET_MARKERS[taxi.id]) {
    FLEET_MARKERS[taxi.id].setLatLng([lat, lng]);
    FLEET_MARKERS[taxi.id].setIcon(icon);
  } else {
    FLEET_MARKERS[taxi.id] = L.marker([lat, lng], { icon }).addTo(FLEET_MAP);
  }
  FLEET_MARKERS[taxi.id].bindPopup(
    `<b>${escapeHtml(taxi.reg_number)}</b><br>${escapeHtml(taxi.driver_name)}<br>Speed: ${pos.Spd} km/h<br>Ignition: ${ignOn ? "On" : "Off"}`
  );
}

function liveRow(taxi, pos) {
  const ignOn = pos.Ign === true || pos.Ign === "true";
  return `
    <div class="board-row">
      <span class="status-dot ${ignOn ? "live" : "upcoming"}"></span>
      <div>
        <div class="from-to">${escapeHtml(taxi.reg_number)}</div>
        <div class="hint">${escapeHtml(taxi.driver_name)}</div>
      </div>
      <div class="mono">${pos.Spd} km/h</div>
      <div><span class="badge ${ignOn ? "live" : "completed"}">${ignOn ? "On" : "Off"}</span></div>
      <div class="hint">${pos.MVolt ? pos.MVolt + "V" : "—"}</div>
      <div class="mono hint">${fmtRelativeTime(pos.TTime)}</div>
    </div>`;
}

function offlineRow(taxi) {
  return `
    <div class="board-row">
      <span class="status-dot cancelled"></span>
      <div>
        <div class="from-to">${escapeHtml(taxi.reg_number)}</div>
        <div class="hint">${escapeHtml(taxi.driver_name)}</div>
      </div>
      <div class="hint">—</div>
      <div><span class="badge cancelled">No signal</span></div>
      <div class="hint">—</div>
      <div class="hint">Not reporting</div>
    </div>`;
}

function fmtRelativeTime(isoLike) {
  if (!isoLike) return "—";
  // NOTE: assuming Hashtrace's TTime is already local (IST), not UTC —
  // this is the common convention for India-focused platforms. If the
  // "min/hr ago" values look consistently off by 5.5 hours, this
  // assumption is wrong: change the line below to
  //   const then = new Date(isoLike + "Z");
  // to treat it as UTC instead.
  const then = new Date(isoLike);
  const diffMin = Math.round((Date.now() - then.getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  return `${Math.round(diffMin / 60)} hr ago`;
}

function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
