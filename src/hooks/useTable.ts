import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

/** Generic Supabase table hook scoped to the signed-in user via RLS. */
export function useTable<T extends { id: string }>(
  table: string,
  order: { column: string; ascending?: boolean } = { column: "created_at", ascending: false },
) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from(table).select("*")
      .order(order.column, { ascending: order.ascending ?? false });
    if (error) setError(error.message);
    else setRows((data ?? []) as T[]);
    setLoading(false);
  }, [table, order.column, order.ascending]);

  useEffect(() => { load(); }, [load]);

  const insert = useCallback(async (row: Partial<T>) => {
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase.from(table)
      .insert({ ...row, user_id: u.user?.id } as never).select().single();
    if (!error && data) setRows((r) => [data as T, ...r]);
    return { error: error?.message };
  }, [table]);

  const update = useCallback(async (id: string, patch: Partial<T>) => {
    console.log("Updating", id, patch);
    const { data, error } = await supabase.from(table).update(patch as never).eq("id", id).select().single();
    if (!error && data) setRows((r) => r.map((x) => (x.id === id ? (data as T) : x)));
    return { error: error?.message };
  }, [table]);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (!error) setRows((r) => r.filter((x) => x.id !== id));
    return { error: error?.message };
  }, [table]);

  return { rows, loading, error, reload: load, insert, update, remove };
}
