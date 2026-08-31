-- Storage objects cannot be deleted directly with SQL. The Edge Function
-- cleanup-expired-data removes files through the supported Storage API first.

drop trigger if exists sync_event_storage_cleanup on public.sync_events;
drop function if exists public.remove_sync_event_storage();

-- Keep fully delivered events until the Edge Function removes their Storage
-- files. Marking them expired makes the next hourly run pick them up.
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

  update public.sync_events
  set received_by = next_received,
      expires_at = case
        when event_row.required_user_ids <@ next_received then least(expires_at, now())
        else expires_at
      end
  where id = p_event_id;
end;
$$;

create or replace function public.remove_already_delivered_sync_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.required_user_ids <@ new.received_by then
    update public.sync_events set expires_at = least(expires_at, now()) where id = new.id;
  end if;
  return new;
end;
$$;

-- Disable the old SQL jobs. They attempted direct storage.objects deletion.
do $$
declare
  old_job record;
begin
  if to_regclass('cron.job') is null then return; end if;
  for old_job in
    select jobid from cron.job
    where jobname in ('purge-ephemeral-sync-events', 'purge-ephemeral-business-data')
  loop
    perform cron.unschedule(old_job.jobid);
  end loop;
exception when others then
  raise notice 'Old cleanup schedules were not removed: %', sqlerrm;
end;
$$;

-- Automatic hourly invocation. Add these two secrets in Supabase Vault:
--   project_url = https://<project-ref>.supabase.co
--   cleanup_cron_secret = the same CLEANUP_CRON_SECRET used by the Edge Function
do $$
declare
  has_url boolean;
  has_key boolean;
begin
  create extension if not exists pg_cron with schema extensions;
  create extension if not exists pg_net with schema extensions;

  select exists(select 1 from vault.decrypted_secrets where name = 'project_url') into has_url;
  select exists(select 1 from vault.decrypted_secrets where name = 'cleanup_cron_secret') into has_key;

  if has_url and has_key and not exists (
    select 1 from cron.job where jobname = 'cleanup-expired-app-data'
  ) then
    perform cron.schedule(
      'cleanup-expired-app-data',
      '0 * * * *',
      $schedule$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
            || '/functions/v1/cleanup-expired-data',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cleanup-secret',
              (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_cron_secret')
          ),
          body := '{}'::jsonb
        );
      $schedule$
    );
  else
    raise notice 'Cleanup schedule not created yet: add project_url and cleanup_cron_secret to Vault, then rerun this migration.';
  end if;
exception when others then
  raise notice 'Cleanup schedule was not installed: %', sqlerrm;
end;
$$;
