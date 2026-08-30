-- Remove completed-order and group-chat data from Supabase after 24 hours.
-- Devices keep their own local IndexedDB copy.
create or replace function public.purge_expired_business_data()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  removed integer := 0;
  affected integer;
begin
  -- Group chat: remove old image files and rows first.
  delete from storage.objects
  where bucket_id = 'order-images'
    and name in (
      select regexp_replace(i.image_url, '^.*/order-images/', '')
      from public.group_message_images i
      join public.group_messages m on m.id = i.message_id
      where m.created_at <= now() - interval '24 hours'
    );
  delete from public.group_message_images i
  using public.group_messages m
  where m.id = i.message_id and m.created_at <= now() - interval '24 hours';
  delete from public.group_messages
  where created_at <= now() - interval '24 hours';
  get diagnostics affected = row_count;
  removed := removed + affected;

  -- Completed orders: remove chat, images, history and the order itself.
  delete from storage.objects
  where bucket_id = 'order-images'
    and name in (
      select regexp_replace(i.image_url, '^.*/order-images/', '')
      from public.order_images i
      join public.orders o on o.id = i.order_id
      where o.status = 'completed'
        and o.updated_at <= now() - interval '24 hours'
    union
      select regexp_replace(i.image_url, '^.*/order-images/', '')
      from public.order_message_images i
      join public.order_messages m on m.id = i.message_id
      join public.orders o on o.id = m.order_id
      where o.status = 'completed'
        and o.updated_at <= now() - interval '24 hours'
    );

  delete from public.order_message_images i
  using public.order_messages m, public.orders o
  where m.id = i.message_id and o.id = m.order_id
    and o.status = 'completed' and o.updated_at <= now() - interval '24 hours';
  delete from public.order_messages m
  using public.orders o
  where o.id = m.order_id
    and o.status = 'completed' and o.updated_at <= now() - interval '24 hours';
  delete from public.order_images i
  using public.orders o
  where o.id = i.order_id
    and o.status = 'completed' and o.updated_at <= now() - interval '24 hours';
  delete from public.order_edit_history h
  using public.orders o
  where o.id = h.order_id
    and o.status = 'completed' and o.updated_at <= now() - interval '24 hours';
  delete from public.orders
  where status = 'completed' and updated_at <= now() - interval '24 hours';
  get diagnostics affected = row_count;
  removed := removed + affected;

  perform public.purge_expired_sync_events();
  return removed;
end;
$$;

grant execute on function public.purge_expired_business_data() to anon, authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'purge-ephemeral-business-data') then
    perform cron.schedule(
      'purge-ephemeral-business-data',
      '0 3 * * *',
      'select public.purge_expired_business_data();'
    );
  end if;
exception when others then
  raise notice 'business data purge schedule was not installed: %', sqlerrm;
end;
$$;
