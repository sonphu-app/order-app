alter table public.orders
  add column if not exists warehouse_a_done boolean not null default false,
  add column if not exists warehouse_a_done_by_name text,
  add column if not exists warehouse_a_done_at timestamptz,
  add column if not exists warehouse_b_done boolean not null default false,
  add column if not exists warehouse_b_done_by_name text,
  add column if not exists warehouse_b_done_at timestamptz;
