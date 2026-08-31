alter table public.orders
  add column if not exists needs_rework boolean not null default false;
