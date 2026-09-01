-- Sổ cân dùng chung cho máy đầu cân và các thiết bị xem từ xa.
-- Giữ dữ liệu tối đa 2 năm; SQLite tại máy đầu cân vẫn là bộ nhớ offline chính.
create table if not exists public.scale_weighings (
  source_id text primary key,
  machine_id text not null,
  local_id bigint,
  series_id text not null default '',
  plate text not null default '',
  plate_note text not null default '',
  customer text not null default '',
  direction text not null default '',
  goods text not null default '',
  gross integer not null default 0,
  tare integer not null default 0,
  net integer not null default 0,
  gross_at timestamptz,
  tare_at timestamptz,
  charge bigint not null default 0,
  paid bigint not null default 0,
  no_charge boolean not null default false,
  cancelled boolean not null default false,
  cancelled_at timestamptz,
  source_created_at timestamptz not null default now(),
  source_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_scale_weighings_updated
  on public.scale_weighings (source_updated_at desc);
create index if not exists idx_scale_weighings_machine_local
  on public.scale_weighings (machine_id, local_id);
create index if not exists idx_scale_weighings_plate
  on public.scale_weighings (plate);

alter table public.scale_weighings enable row level security;
drop policy if exists "scale weighings readable" on public.scale_weighings;
drop policy if exists "scale weighings writable" on public.scale_weighings;
create policy "scale weighings readable" on public.scale_weighings
  for select to anon, authenticated using (true);
create policy "scale weighings writable" on public.scale_weighings
  for insert, update to anon, authenticated
  using (true) with check (true);
grant select, insert, update on public.scale_weighings to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.scale_weighings;
exception when duplicate_object then
  null;
end $$;

create or replace function public.purge_old_scale_weighings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.scale_weighings
  where source_updated_at < now() - interval '2 years';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

do $$
begin
  create extension if not exists pg_cron with schema extensions;
  if not exists (
    select 1 from cron.job where jobname = 'purge-old-scale-weighings'
  ) then
    perform cron.schedule(
      'purge-old-scale-weighings',
      '0 3 * * *',
      'select public.purge_old_scale_weighings();'
    );
  end if;
exception when others then
  raise notice 'pg_cron chưa bật; có thể gọi public.purge_old_scale_weighings() thủ công.';
end $$;

select public.purge_old_scale_weighings();
