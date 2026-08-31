do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'orders',
    'order_messages',
    'order_images',
    'order_message_images',
    'group_messages',
    'group_message_images'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    exception when duplicate_object then
      null;
    end;
    execute format('alter table public.%I replica identity full', table_name);
  end loop;
end $$;
