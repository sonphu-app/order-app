-- Gửi Web Push từ database ngay khi tin nhắn được tạo.
-- Cách này không phụ thuộc tab của người gửi còn mở sau khi bấm gửi.

create or replace function public.push_group_chat_from_database()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sender_id is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://xjcfauhswufiizkuggqx.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'type', 'group_chat',
      'actorId', new.sender_id,
      'actorName', coalesce(nullif(new.sender_name, ''), 'Nhân viên'),
      'title', '💬 Chat nhóm - ' || coalesce(nullif(new.sender_name, ''), 'Nhân viên'),
      'body', left(coalesce(nullif(btrim(new.text), ''), 'Tin nhắn mới'), 100),
      'url', '/chat',
      'notificationId', 'group_' || new.id::text
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists group_chat_web_push on public.group_messages;
create trigger group_chat_web_push
after insert on public.group_messages
for each row execute function public.push_group_chat_from_database();

create or replace function public.push_order_chat_from_database()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  order_label text;
begin
  if new.sender_id is null then
    return new;
  end if;

  select coalesce(nullif(title, ''), nullif(content, ''), 'Đơn')
  into order_label
  from public.orders
  where id = new.order_id;

  perform net.http_post(
    url := 'https://xjcfauhswufiizkuggqx.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'type', 'order_chat',
      'actorId', new.sender_id,
      'actorName', coalesce(nullif(new.sender_name, ''), 'Nhân viên'),
      'title', '💬 Chat đơn - ' || coalesce(nullif(new.sender_name, ''), 'Nhân viên'),
      'body', left(coalesce(order_label, 'Đơn'), 40) || ' | ' ||
        left(coalesce(nullif(btrim(new.text), ''), 'Tin nhắn mới'), 70),
      'url', '/order/' || new.order_id::text,
      'orderId', new.order_id,
      'notificationId', 'order_' || new.id::text
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists order_chat_web_push on public.order_messages;
create trigger order_chat_web_push
after insert on public.order_messages
for each row execute function public.push_order_chat_from_database();
