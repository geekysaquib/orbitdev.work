import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { getUser } from "../lib/auth";
import { getOnline, OFFLINE_ERROR } from "../lib/offline";

/** Generic Supabase table hook scoped to the signed-in user via RLS. */
export function useTable<T extends { id: string }>(
  table: string,
  order: { column: string; ascending?: boolean } = { column: "created_at", ascending: false },
) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    const { data, error } = await supabase.from(table).select("*")
      .order(order.column, { ascending: order.ascending ?? false });
    if (id !== requestId.current) return; // a newer load()/reload() already superseded this one
    if (error) setError(error.message);
    else setRows((data ?? []) as T[]);
    setLoading(false);
  }, [table, order.column, order.ascending]);

  useEffect(() => { load(); }, [load]);

  const insert = useCallback(async (row: Partial<T>) => {
    if (!getOnline()) return { error: OFFLINE_ERROR };
    const u = getUser();
    if (!u) return { error: "You're signed out — sign in and try again." };
    // `table` is a runtime string, not a `keyof Database['public']['Tables']` literal, so
    // supabase-js can't resolve which row shape applies here — that's genuinely `never` at
    // the type level for a dynamic key. The tables this hook is actually called with
    // (see src/lib/database.types.ts) all accept `{ ...T, user_id }`, so this is safe.
    const { data, error } = await supabase.from(table)
      .insert({ ...row, user_id: u.id } as never).select().single();
    if (!error && data) setRows((r) => [data as T, ...r]);
    return { error: error?.message };
  }, [table]);

  const update = useCallback(async (id: string, patch: Partial<T>) => {
    if (!getOnline()) return { error: OFFLINE_ERROR };
    // Same reasoning as insert() above — dynamic table name, so Update resolves to `never`.
    const { data, error } = await supabase.from(table).update(patch as never).eq("id", id).select().single();
    if (!error && data) setRows((r) => r.map((x) => (x.id === id ? (data as T) : x)));
    return { error: error?.message };
  }, [table]);

  const remove = useCallback(async (id: string) => {
    if (!getOnline()) return { error: OFFLINE_ERROR };
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (!error) setRows((r) => r.filter((x) => x.id !== id));
    return { error: error?.message };
  }, [table]);

  return { rows, loading, error, reload: load, insert, update, remove };
}
