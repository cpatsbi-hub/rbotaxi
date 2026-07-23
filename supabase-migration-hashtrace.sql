-- ============================================================
-- MIGRATION: Link vehicles to their Hashtrace GPS tracker
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- Safe to run on your existing database — additive only.
-- ============================================================

alter table public.taxis
  add column if not exists gps_imei text;

-- Optional but recommended: prevent the same tracker being assigned
-- to two different taxis by mistake. Allows multiple NULLs (vehicles
-- with no tracker yet) since a partial unique index skips them.
create unique index if not exists taxis_gps_imei_unique
  on public.taxis (gps_imei)
  where gps_imei is not null;
