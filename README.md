# Office Taxi Movement Tracker

A free, no-billing-account web app for booking and tracking office taxi
journeys, with car-pooling, an archive, and an admin console.

**Concept by Josmy Joseph and designed by Sunil C P**

## Stack (all free tier, no card required anywhere)
- **Frontend**: plain HTML/CSS/JS, hosted free on **GitHub Pages**
- **Backend**: **Supabase** free tier — Postgres database, Auth (email/password
  login + self sign-up), and Storage (for geo-tagged photos)
- **Maps**: **Leaflet.js + OpenStreetMap** tiles (no API key)
- **Place search / geocoding**: **Nominatim** (OpenStreetMap's free geocoder)
- **Routing**: **OSRM** public demo server (free driving directions)

## 1. Create your Supabase project
1. Go to https://supabase.com → sign up free → **New project**.
2. Once it's ready, open **SQL Editor → New query**, paste the entire
   contents of `supabase-schema.sql` from this project, and run it.
   This creates all tables, security rules, and the private photo storage
   bucket in one go.
3. Go to **Project Settings → API** and copy:
   - **Project URL**
   - **anon / public key**
4. Open `js/supabase-client.js` in this project and paste them in:
   ```js
   const SUPABASE_URL = "https://xxxxx.supabase.co";
   const SUPABASE_ANON_KEY = "eyJ...";
   ```
5. In **Authentication → Providers**, email sign-up is on by default. If you
   don't want the confirmation email step (fine for an internal office tool),
   go to **Authentication → Settings** and turn off "Confirm email".

## 2. Make yourself an admin
Sign up once through the app's login page, then in Supabase's **SQL Editor**
run:
```sql
update public.profiles set is_admin = true where email = 'you@yourcompany.com';
```
You'll then see the **Admin** tab in the top navigation.

## 3. Deploy to GitHub Pages
1. Create a new GitHub repository and push everything in this project folder
   to it (keep the file structure as-is).
2. In the repo, go to **Settings → Pages** → set **Source** to your main
   branch, root folder.
3. GitHub gives you a URL like `https://yourname.github.io/repo-name/` —
   that's your live app.

## How the free map stack works
- **Leaflet + OpenStreetMap**: draws the map itself, no key needed.
- **Nominatim**: powers the place-search boxes when booking a journey
  (origin, destination, via stops). It's a shared community service —
  perfectly fine for office-scale usage, just avoid firing off requests in
  a tight loop (the app already debounces searches).
- **OSRM demo server**: calculates the actual road route, distance, and
  drive-time estimate between the points you pick, and returns the road
  geometry so the drawn line follows real roads rather than a straight line.
- If your team ever outgrows the shared demo servers, both Nominatim and
  OSRM can be self-hosted for free — the app code wouldn't need to change,
  just the URLs in `js/map-utils.js`.

## Where are the photos stored?
**Not Google Drive.** They're stored in a **private Supabase Storage
bucket** (`journey-photos`), which is simpler and more secure for this
purpose — Drive would require routing every upload through OAuth consent
screens and API scopes just to get basic access control.

Security model in place:
- The bucket is **private** — nothing is publicly reachable by URL.
- Every request is encrypted in transit (HTTPS/TLS).
- Supabase encrypts stored files at rest on their servers.
- Access is enforced by **Row Level Security policies** (see
  `supabase-schema.sql`): a photo is only visible to the person who
  uploaded it, the other travellers on that same journey, and admins.
- The app displays photos via **short-lived signed URLs** (1 hour), not
  permanent public links.

This covers "reasonable, standard" encryption and access control for an
internal tool. It is **not** end-to-end encryption (where even Supabase
couldn't technically read the files) — that would need client-side
encryption/decryption keys managed per user, which is a meaningfully bigger
project. Ask if you want that added later.

## What's included
- **Dashboard** (`index.html`): live/upcoming journeys, booked person,
  taxi reg. number, driver, route with via-points, mandatory start/return
  time, live ETA, and a **+** icon to join a journey for car-pooling.
- **New journey form**: place autocomplete for origin/destination/via
  points, live route preview on the map, auto-calculated distance and
  drive time.
- **Archive** (`archive.html`): past journeys as a sortable list
  (recent → past or past → recent) or via a calendar date picker.
- **Admin console** (`admin.html`, visible only to admin accounts):
  every journey across the system, a photo review gallery filterable by
  journey (each photo shows who uploaded it and its map location), and a
  user/role list.
- Status (upcoming/live/completed) is computed automatically from the
  journey's start and return time — nobody has to update it by hand.
  Cancelling a journey is the one manual admin action.

## Known limitations to be aware of
- Nominatim/OSRM are shared free services with fair-use rate limits — fine
  for office use, but not built for high-volume production traffic.
- No automated tests included; this is a functional first version meant to
  be iterated on.
- Photo encryption is "at rest + access-controlled," not end-to-end — see
  note above.
