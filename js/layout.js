// Builds the shared top navigation bar on every protected page.
async function renderTopbar(session, activePage) {
  const profile = await getProfile(session.user.id);
  const root = document.getElementById("topbar");
  const links = [
    ["index.html", "Dashboard"],
    ["archive.html", "Archive"],
    ["live-map.html", "Live Fleet"],
  ];
  if (profile && profile.is_admin) links.push(["admin.html", "Admin"]);

  root.innerHTML = `
    <div class="brand">
      <div class="brand-mark">OT</div>
      <div class="brand-name">Office Taxi Tracker</div>
    </div>
    <div class="nav-links">
      ${links.map(([href, label]) => `<a href="${href}" class="${activePage === href ? "active" : ""}">${label}</a>`).join("")}
    </div>
    <div class="user-chip">
      <span>${profile ? profile.full_name : session.user.email}</span>
      <div class="avatar">${initials(profile ? profile.full_name : session.user.email)}</div>
      <button class="btn btn-ghost btn-sm" id="signOutBtn">Sign out</button>
    </div>
  `;
  document.getElementById("signOutBtn").addEventListener("click", signOut);
  return profile;
}

function renderFooter() {
  const el = document.createElement("div");
  el.className = "footer-credit";
  el.textContent = "Concept by Josmy Joseph and designed by Sunil C P";
  document.body.appendChild(el);
}
