import { createClient } from "@supabase/supabase-js";
import { getToken } from "./auth";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  // Surfaced early so setup mistakes are obvious in dev.
  console.warn("[ORBIT] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env");
}

// ORBIT doesn't use Supabase Auth — sessions come from our own OTP-based login
// (netlify/functions/auth.ts), which signs JWTs with the project's own JWT
// secret using the same claim shape Supabase Auth would produce. Handing that
// token over via `accessToken` keeps every existing RLS policy (`auth.uid()`)
// working unchanged. Note: setting this option disables `supabase.auth.*` —
// use src/lib/auth.ts for session state instead.
export const supabase = createClient(url ?? "", anon ?? "", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  accessToken: async () => getToken(),
});
