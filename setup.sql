-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/hqhucwxczutpwvddtuws/sql

CREATE TABLE IF NOT EXISTS orders (
  id bigint generated always as identity primary key,
  ref text unique not null,
  status text default 'pending',
  card text,
  watch text,
  st text default 'citizen',
  name text,
  id_number text,
  phone text,
  email text,
  gender text default 'male',
  emirate text,
  age text,
  address text,
  lang text default 'ar',
  step text,
  decision text,
  reason text,
  next_step text,
  pay jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS site_visitors (
  id bigint generated always as identity primary key,
  visitor_id text not null,
  page text,
  created_at timestamptz default now()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_visitors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_all ON orders;
CREATE POLICY orders_all ON orders FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS sv_all ON site_visitors;
CREATE POLICY sv_all ON site_visitors FOR ALL USING (true) WITH CHECK (true);
