-- Hiển thị người gửi và tên đơn rõ ràng trong thông báo chat đơn.
-- Không thay đổi cách gửi push hoặc danh sách thiết bị nhận.

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

  select left(
    split_part(
      coalesce(nullif(btrim(title), ''), nullif(btrim(content), ''), 'Đơn'),
      E'\n',
      1
    ),
    80
  )
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
      'title', coalesce(order_label, 'Đơn') || ' - ' ||
        coalesce(nullif(new.sender_name, ''), 'Nhân viên'),
      'body', left(coalesce(nullif(btrim(new.text), ''), 'Tin nhắn mới'), 120),
      'url', '/order/' || new.order_id::text,
      'orderId', new.order_id,
      'notificationId', 'order_' || new.id::text
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;
