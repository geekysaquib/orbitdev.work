import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Static consistency checks between the fresh-install path (schema.sql) and
// the upgrade path (migrations.sql) — RC1 task 6 found these two files can
// silently drift (a table present in one but not the other, a differently
// named policy for the same rule) with no automated signal. This doesn't
// replace running the SQL against a real Postgres (no live DB in this
// sandbox — see docs/architecture/rc1-release.md task 4), it just guards
// against the specific class of bug found in that audit recurring.
const schema = readFileSync(resolve(process.cwd(), "supabase/schema.sql"), "utf8");
const migrations = readFileSync(resolve(process.cwd(), "supabase/migrations.sql"), "utf8");

function tableArrays(sql: string): string[][] {
  return [...sql.matchAll(/foreach t in array array\[([^\]]+)\]/g)].map((m) =>
    m[1].split(",").map((s) => s.trim().replace(/^'/, "").replace(/'$/, "")),
  );
}

// These tables existed before migrations.sql did (it's a consolidation of
// what used to be separate add_*.sql files for an already-deployed project —
// see its own header comment) — they're foundational, never (re)created by
// this file, so they're expected exclusions here, not a gap.
const PREDATES_MIGRATIONS_FILE = new Set([
  "users", "otp_codes", "projects", "tasks", "tickets", "events", "notifications", "time_entries",
]);

describe("schema.sql vs migrations.sql consistency", () => {
  it("every table schema.sql enables RLS on (added after migrations.sql existed) also has a create table statement there", () => {
    const [rlsTables] = tableArrays(schema); // the RLS-enable loop is the first array[] in the file
    expect(rlsTables.length).toBeGreaterThan(20); // sanity check the regex actually matched something real

    const checked = rlsTables.filter((t) => !PREDATES_MIGRATIONS_FILE.has(t));
    expect(checked.length).toBeGreaterThan(10);
    const missing = checked.filter((t) => !new RegExp(`create table if not exists public\\.${t}\\b`).test(migrations));
    expect(missing).toEqual([]);
  });

  it("integrations.user_id references public.users, not auth.users", () => {
    expect(migrations).not.toMatch(/references auth\.users/);
    expect(schema).not.toMatch(/references auth\.users/);
  });

  it("integrations gets the same 'owner all' policy in both files", () => {
    // schema.sql grants it via the generic per-table loop, not a literal
    // statement — find whichever array[] block is followed by an "owner all"
    // policy and confirm 'integrations' is a member of it.
    const ownerAllLoopTables = tableArrays(schema).find((_, i) => {
      const idx = schema.indexOf(`array[${tableArrays(schema)[i].map((t) => `'${t}'`).join(",")}]`);
      return schema.slice(idx, idx + 400).includes('"owner all"');
    });
    expect(ownerAllLoopTables).toContain("integrations");
    expect(migrations).toMatch(/create policy "owner all" on public\.integrations/);
    expect(migrations).not.toMatch(/create policy "own integrations"/);
  });

  it("is_team_member's default PUBLIC execute grant is revoked in both files", () => {
    for (const sql of [schema, migrations]) {
      expect(sql).toMatch(/revoke execute on function public\.is_team_member\(uuid, uuid\) from public/);
      expect(sql).toMatch(/grant execute on function public\.is_team_member\(uuid, uuid\) to authenticated/);
    }
  });

  it("create_team_with_owner and transfer_team_ownership revoke PUBLIC execute in both files", () => {
    for (const sql of [schema, migrations]) {
      expect(sql).toMatch(/revoke execute on function public\.create_team_with_owner\(text, uuid\) from public/);
      expect(sql).toMatch(/revoke execute on function public\.transfer_team_ownership\(uuid, uuid, uuid\) from public/);
    }
  });
});
