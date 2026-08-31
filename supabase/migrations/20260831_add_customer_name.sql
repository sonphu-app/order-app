alter table public.orders
  add column if not exists customer_name text;

alter table public.orders
  add column if not exists done_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists completed_at timestamptz;
