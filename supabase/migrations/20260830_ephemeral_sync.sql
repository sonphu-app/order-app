-- Supabase acts only as a temporary delivery relay.
-- Business data is retained by each device in IndexedDB.

create table if not exists public.sync_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  operation text not null default 'upsert' check (operation in ('upsert', 'delete')),
  payload jsonb not null default '{}'::jsonb,
  storage_paths text[] not null default '{}'::text[],
  required_user_ids uuid[] not null default '{}'::uuid[],
  received_by uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 day')
);

create index if not exists sync_events_created_at_idx on public.sync_events (created_at);
create index if not exists sync_events_expires_at_idx on public.sync_events (expires_at);

alter table public.sync_events enable row level security;

drop policy if exists "sync_events_select" on public.sync_events;
create policy "sync_events_select" on public.sync_events for select to anon, authenticated using (true);

drop policy if exists "sync_events_insert" on public.sync_events;
create policy "sync_events_insert" on public.sync_events for insert to anon, authenticated with check (true);

grant select, insert on public.sync_events to anon, authenticated;

create or replace function public.ack_sync_event(p_event_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.sync_events;
  next_received uuid[];
begin
  select * into event_row
  from public.sync_events
  where id = p_event_id
  for update;

  if not found then return; end if;

  next_received := case
    when p_user_id = any(event_row.received_by) then event_row.received_by
    else array_append(event_row.received_by, p_user_id)
  end;

  if event_row.required_user_ids <@ next_received then
    delete from public.sync_events where id = p_event_id;
  else
    update public.sync_events
    set received_by = next_received
    where id = p_event_id;
  end if;
end;
$$;

grant execute on function public.ack_sync_event(uuid, uuid) to anon, authenticated;

create or replace function public.remove_sync_event_storage()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  if coalesce(array_length(old.storage_paths, 1), 0) > 0 then
    delete from storage.objects
    where bucket_id = 'order-images'
      and name = any(old.storage_paths);
  end if;
  return old;
end;
$$;

drop trigger if exists sync_event_storage_cleanup on public.sync_events;
create trigger sync_event_storage_cleanup
after delete on public.sync_events
for each row execute function public.remove_sync_event_storage();

create or replace function public.remove_already_delivered_sync_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.required_user_ids <@ new.received_by then
    delete from public.sync_events where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_event_delivered_cleanup on public.sync_events;
create trigger sync_event_delivered_cleanup
after insert on public.sync_events
for each row execute function public.remove_already_delivered_sync_event();

create or replace function public.purge_expired_sync_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.sync_events where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- Supabase projects normally include pg_cron. If it is available, purge every 15 minutes.
do $$
begin
  create extension if not exists pg_cron with schema extensions;
  if not exists (select 1 from cron.job where jobname = 'purge-ephemeral-sync-events') then
    perform cron.schedule(
      'purge-ephemeral-sync-events',
      '*/15 * * * *',
      'select public.purge_expired_sync_events();'
    );
  end if;
exception when others then
  raise notice 'pg_cron schedule was not installed: %', sqlerrm;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sync_events'
  ) then
    alter publication supabase_realtime add table public.sync_events;
  end if;
end;
$$;
