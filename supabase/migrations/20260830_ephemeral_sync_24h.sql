-- Shorten the temporary relay lifetime to 24 hours.
alter table if exists public.sync_events
  alter column expires_at set default (now() + interval '1 day');

update public.sync_events
set expires_at = least(expires_at, created_at + interval '1 day');

select public.purge_expired_sync_events();
