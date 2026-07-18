-- ============================================================
-- Office Taxi Movement Tracker — Supabase schema
-- Run this once in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. PROFILES ---------------------------------------------------
-- One row per registered user. Created automatically on sign-up.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever someone signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. JOURNEYS -----------------------------------------------------
create table if not exists public.journeys (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id),
  booked_person_name text not null,
  origin_name text not null,
  origin_lat double precision not null,
  origin_lng double precision not null,
  destination_name text not null,
  destination_lat double precision not null,
  destination_lng double precision not null,
  via_points jsonb not null default '[]',       -- [{name,lat,lng}, ...]
  route_geojson jsonb,                          -- cached OSRM route geometry
  distance_km numeric,
  duration_min numeric,
  journey_date date not null,
  start_time timestamptz not null,
  return_time timestamptz,
  taxi_reg_number text not null,
  driver_name text not null,
  status text not null default 'upcoming' check (status in ('upcoming','live','completed','cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists journeys_date_idx on public.journeys (journey_date desc);
create index if not exists journeys_status_idx on public.journeys (status);

-- 3. CAR-POOL PARTICIPANTS ----------------------------------------
create table if not exists public.journey_participants (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  joined_at timestamptz not null default now(),
  unique (journey_id, user_id)
);

-- 4. GEO-TAGGED PHOTOS ----------------------------------------------
create table if not exists public.journey_photos (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  storage_path text not null,       -- path inside the private 'journey-photos' bucket
  lat double precision,
  lng double precision,
  captured_at timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.journeys enable row level security;
alter table public.journey_participants enable row level security;
alter table public.journey_photos enable row level security;

-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$ language sql stable security definer;

-- Profiles: everyone logged in can read names (needed to show "joined by"),
-- but only the owner (or admin) can update their own row.
create policy "profiles are readable by authenticated users"
  on public.profiles for select to authenticated using (true);

create policy "users can update their own profile"
  on public.profiles for update to authenticated using (auth.uid() = id);

-- Journeys: any signed-in user can view, create, and join.
-- Only the creator or an admin can edit/cancel it.
create policy "journeys readable by authenticated users"
  on public.journeys for select to authenticated using (true);

create policy "authenticated users can create journeys"
  on public.journeys for insert to authenticated with check (auth.uid() = created_by);

create policy "creator or admin can update journey"
  on public.journeys for update to authenticated
  using (auth.uid() = created_by or public.is_admin());

create policy "creator or admin can delete journey"
  on public.journeys for delete to authenticated
  using (auth.uid() = created_by or public.is_admin());

-- Participants: anyone can see who joined; users add/remove only themselves.
create policy "participants readable by authenticated users"
  on public.journey_participants for select to authenticated using (true);

create policy "users can join a journey"
  on public.journey_participants for insert to authenticated with check (auth.uid() = user_id);

create policy "users can leave a journey they joined"
  on public.journey_participants for delete to authenticated using (auth.uid() = user_id);

-- Photos: uploader, fellow travellers on that journey, and admins can view.
-- Only the uploader (or admin) can insert/delete their own photo record.
create policy "photo visible to uploader, journey participants, or admin"
  on public.journey_photos for select to authenticated using (
    auth.uid() = user_id
    or public.is_admin()
    or exists (
      select 1 from public.journey_participants p
      where p.journey_id = journey_photos.journey_id and p.user_id = auth.uid()
    )
    or exists (
      select 1 from public.journeys j
      where j.id = journey_photos.journey_id and j.created_by = auth.uid()
    )
  );

create policy "users can upload their own photo record"
  on public.journey_photos for insert to authenticated with check (auth.uid() = user_id);

create policy "uploader or admin can delete photo record"
  on public.journey_photos for delete to authenticated
  using (auth.uid() = user_id or public.is_admin());

-- ============================================================
-- STORAGE BUCKET (run in Storage → or via SQL below)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('journey-photos', 'journey-photos', false)
on conflict (id) do nothing;

-- Storage policies: same visibility rule as the journey_photos table.
-- Path convention enforced by the app: {journey_id}/{user_id}/{filename}
create policy "authenticated users can upload their own photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'journey-photos' and (storage.foldername(name))[2] = auth.uid()::text);

create policy "read own, journey-mates, or admin"
  on storage.objects for select to authenticated using (
    bucket_id = 'journey-photos' and (
      (storage.foldername(name))[2] = auth.uid()::text
      or public.is_admin()
      or exists (
        select 1 from public.journey_participants p
        where p.journey_id::text = (storage.foldername(name))[1] and p.user_id = auth.uid()
      )
      or exists (
        select 1 from public.journeys j
        where j.id::text = (storage.foldername(name))[1] and j.created_by = auth.uid()
      )
    )
  );

-- ============================================================
-- To make the FIRST admin: after you sign up once in the app, run:
--   update public.profiles set is_admin = true where email = 'you@yourcompany.com';
-- ============================================================
