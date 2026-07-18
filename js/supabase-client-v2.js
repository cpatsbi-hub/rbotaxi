// ============================================================
// Supabase project credentials
// ============================================================
const SUPABASE_URL = "https://hmwhhckjvpyefsjwajwz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhtd2hoY2tqdnB5ZWZzandhand6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxOTE2OTUsImV4cCI6MjA5OTc2NzY5NX0.zQITlw8huawp3Qz7m3CvJTGYC6vpzmX6W3wqD9TsW1I";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PHOTO_BUCKET = "journey-photos";

// Redirect to login if not authenticated. Call at the top of protected pages.
async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return null;
  }
  return session;
}

async function getProfile(userId) {
  const { data, error } = await sb.from("profiles").select("*").eq("id", userId).single();
  if (error) { console.error(error); return null; }
  return data;
}

async function signOut() {
  await sb.auth.signOut();
  window.location.href = "login.html";
}

function showToast(message, type = "") {
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function initials(name) {
  return (name || "?").split(" ").filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
}

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr + "T00:00:00").toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}
