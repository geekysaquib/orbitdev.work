import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  // Surfaced early so setup mistakes are obvious in dev.
  console.warn("[ORBIT] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env");
}

export const supabase = createClient(url ?? "", anon ?? "", {
  auth: { persistSession: true, autoRefreshToken: true },
});
