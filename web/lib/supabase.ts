// web/lib/supabase.ts — ブラウザ用 Supabase クライアント（任意）
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const hasSupabase = Boolean(url && anon && !anon.startsWith("replace"));

export const supabase = hasSupabase ? createClient(url!, anon!) : null;

export const functionsUrl =
  process.env.NEXT_PUBLIC_FUNCTIONS_URL ?? "http://127.0.0.1:54321/functions/v1";
