-- ============================================================
-- MIGRATION: Vehicle registry ("taxis" table)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- Safe to run on your existing database — does not touch or
-- modify any table you already have.
-- ============================================================

-- 1. TAXIS ---------------------------------------------------
create table if not exists public.taxis (
  id uuid primary key default gen_random_uuid(),
  reg_number text not null unique,
  driver_name text not null,
  vehicle_model text,             -- optional, e.g. "Toyota Etios"
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.taxis enable row level security;

-- Everyone signed in can see the fleet (needed to populate the booking dropdown)
create policy "taxis readable by authenticated users"
  on public.taxis for select to authenticated using (true);

-- Only admins can add, edit, or remove vehicles
create policy "admin can insert taxis"
  on public.taxis for insert to authenticated with check (public.is_admin());

create policy "admin can update taxis"
  on public.taxis for update to authenticated using (public.is_admin());

create policy "admin can delete taxis"
  on public.taxis for delete to authenticated using (public.is_admin());

-- 2. LINK JOURNEYS TO A TAXI (optional reference, keeps existing data intact) --
-- reg_number/driver_name stay on the journeys table too (denormalized on
-- purpose) so historical journeys still show correctly even if a vehicle
-- is later renamed or removed from the fleet.
alter table public.journeys
  add column if not exists taxi_id uuid references public.taxis(id);
