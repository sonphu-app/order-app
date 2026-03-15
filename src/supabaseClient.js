import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://xjcfauhswufiizkuggqx.supabase.co";
const supabaseAnonKey = "sb_publishable_y5VTtVkL45InUQ29hOQfzQ_BYk_NZaE";

let supabase;

if (!globalThis.__supabase) {
  globalThis.__supabase = createClient(supabaseUrl, supabaseAnonKey);
}

supabase = globalThis.__supabase;

export { supabase };