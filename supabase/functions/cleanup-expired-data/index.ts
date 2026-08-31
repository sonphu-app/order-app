// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "order-images";
const MAX_BATCH = 200;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function chunks<T>(items: T[], size = MAX_BATCH) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function storagePath(value?: string | null) {
  if (!value || value.startsWith("blob:") || value.startsWith("data:")) return null;
  if (!value.includes("://")) return value.replace(/^\/+/, "");

  try {
    const pathname = new URL(value).pathname;
    const marker = `/storage/v1/object/public/${BUCKET}/`;
    const signedMarker = `/storage/v1/object/sign/${BUCKET}/`;
    const authenticatedMarker = `/storage/v1/object/authenticated/${BUCKET}/`;
    const matchedMarker = [marker, signedMarker, authenticatedMarker].find((item) => pathname.includes(item));
    if (!matchedMarker) return null;
    return decodeURIComponent(pathname.split(matchedMarker)[1] || "");
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cleanupCronSecret = Deno.env.get("CLEANUP_CRON_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !cleanupCronSecret) {
    return json({ error: "Missing Supabase environment" }, 500);
  }

  // Khóa này chỉ dùng cho Cron, không phải service-role key của project.
  if (req.headers.get("x-cleanup-secret") !== cleanupCronSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const removed = { storageFiles: 0, syncEvents: 0, groupMessages: 0, orders: 0 };

  try {
    const [{ data: oldGroups, error: groupError }, { data: oldOrders, error: orderError }, { data: expiredEvents, error: eventError }] =
      await Promise.all([
        supabase.from("group_messages").select("id").lte("created_at", cutoff),
        supabase
          .from("orders")
          .select("id")
          .in("status", ["completed", "hoan_thanh"])
          .not("delivered_by_name", "is", null)
          .neq("delivered_by_name", "")
          .lte("updated_at", cutoff),
        supabase.from("sync_events").select("id, storage_paths").lte("expires_at", new Date().toISOString()),
      ]);

    if (groupError) throw groupError;
    if (orderError) throw orderError;
    if (eventError && eventError.code !== "42P01") throw eventError;

    const groupIds = (oldGroups || []).map((row: any) => row.id);
    const orderIds = (oldOrders || []).map((row: any) => row.id);
    const messageIds: string[] = [];
    const imageRows: any[] = [];

    for (const batch of chunks(groupIds)) {
      const { data, error } = await supabase.from("group_message_images").select("id, image_url").in("message_id", batch);
      if (error) throw error;
      imageRows.push(...(data || []));
    }

    for (const batch of chunks(orderIds)) {
      const [{ data: messages, error: messageError }, { data: images, error: imageError }] = await Promise.all([
        supabase.from("order_messages").select("id").in("order_id", batch),
        supabase.from("order_images").select("id, image_url").in("order_id", batch),
      ]);
      if (messageError) throw messageError;
      if (imageError) throw imageError;
      messageIds.push(...(messages || []).map((row: any) => row.id));
      imageRows.push(...(images || []));
    }

    for (const batch of chunks(messageIds)) {
      const { data, error } = await supabase.from("order_message_images").select("id, image_url").in("message_id", batch);
      if (error) throw error;
      imageRows.push(...(data || []));
    }

    const eventPaths = (expiredEvents || []).flatMap((event: any) => event.storage_paths || []);
    const paths = unique([...imageRows.map((row) => storagePath(row.image_url)), ...eventPaths].filter(Boolean) as string[]);
    for (const batch of chunks(paths, 100)) {
      const { error } = await supabase.storage.from(BUCKET).remove(batch);
      if (error) throw error;
      removed.storageFiles += batch.length;
    }

    for (const batch of chunks(groupIds)) {
      const { error } = await supabase.from("group_message_images").delete().in("message_id", batch);
      if (error) throw error;
      const { error: parentError } = await supabase.from("group_messages").delete().in("id", batch);
      if (parentError) throw parentError;
      removed.groupMessages += batch.length;
    }

    for (const batch of chunks(messageIds)) {
      const { error } = await supabase.from("order_message_images").delete().in("message_id", batch);
      if (error) throw error;
    }
    for (const batch of chunks(orderIds)) {
      for (const table of ["order_messages", "order_images", "order_edit_history"]) {
        const { error } = await supabase.from(table).delete().in("order_id", batch);
        if (error) throw error;
      }
      const { error } = await supabase.from("orders").delete().in("id", batch);
      if (error) throw error;
      removed.orders += batch.length;
    }

    const expiredEventIds = (expiredEvents || []).map((row: any) => row.id);
    for (const batch of chunks(expiredEventIds)) {
      const { error } = await supabase.from("sync_events").delete().in("id", batch);
      if (error) throw error;
      removed.syncEvents += batch.length;
    }

    return json({ ok: true, cutoff, removed });
  } catch (error: any) {
    console.error("cleanup-expired-data:", error);
    return json({ ok: false, error: error?.message || "Cleanup failed", removed }, 500);
  }
});
