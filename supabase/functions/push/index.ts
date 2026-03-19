// deno-lint-ignore-file no-explicit-any
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    webpush.setVapidDetails(
      "mailto:admin@example.com",
      vapidPublicKey,
      vapidPrivateKey
    );

    const {
      type,
      actorId,
      title,
      body: messageBody,
      url,
      orderId,
    } = body || {};

    if (!type || !actorId || !title) {
      return new Response(JSON.stringify({ error: "Thiếu dữ liệu" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // lấy danh sách thiết bị còn active, trừ người gửi
    const { data: subs, error: subErr } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth, is_active")
      .eq("is_active", true)
      .neq("user_id", actorId);

    if (subErr) {
      return new Response(JSON.stringify({ error: subErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.stringify({
      title,
      body: messageBody || "",
      url: url || "/",
      type: type || "general",
      orderId: orderId || null,
    });

    const results: any[] = [];

    for (const sub of subs || []) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          payload
        );

        results.push({ endpoint: sub.endpoint, ok: true });
      } catch (err: any) {
        results.push({
          endpoint: sub.endpoint,
          ok: false,
          statusCode: err?.statusCode || null,
          message: err?.message || "push failed",
        });

        // endpoint chết thì tự tắt
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await supabase
            .from("push_subscriptions")
            .update({ is_active: false })
            .eq("endpoint", sub.endpoint);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});