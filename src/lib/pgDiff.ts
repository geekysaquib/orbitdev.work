import type { PgSchema, PgColumn } from "./pg";

export interface ColumnChange { name: string; from: PgColumn; to: PgColumn; }
export interface TableDiff {
  key: string; schema: string; name: string;
  status: "added" | "removed" | "changed";
  addedColumns: PgColumn[];
  removedColumns: PgColumn[];
  changedColumns: ColumnChange[];
}

const tableKey = (t: { schema: string; name: string }) => `${t.schema}.${t.name}`;
const colChanged = (a: PgColumn, b: PgColumn) =>
  a.type !== b.type || a.nullable !== b.nullable || a.default !== b.default || a.isPrimaryKey !== b.isPrimaryKey;

/** Client-side diff over two /pg/schema snapshots — no new agent endpoint, /pg/schema already returns everything needed. */
export function diffSchemas(before: PgSchema, after: PgSchema): TableDiff[] {
  const beforeMap = new Map(before.tables.map((t) => [tableKey(t), t]));
  const afterMap = new Map(after.tables.map((t) => [tableKey(t), t]));
  const diffs: TableDiff[] = [];

  for (const key of new Set([...beforeMap.keys(), ...afterMap.keys()])) {
    const a = beforeMap.get(key), b = afterMap.get(key);
    if (a && !b) { diffs.push({ key, schema: a.schema, name: a.name, status: "removed", addedColumns: [], removedColumns: a.columns, changedColumns: [] }); continue; }
    if (!a && b) { diffs.push({ key, schema: b.schema, name: b.name, status: "added", addedColumns: b.columns, removedColumns: [], changedColumns: [] }); continue; }
    if (!a || !b) continue;

    const beforeCols = new Map(a.columns.map((c) => [c.name, c]));
    const afterCols = new Map(b.columns.map((c) => [c.name, c]));
    const addedColumns = b.columns.filter((c) => !beforeCols.has(c.name));
    const removedColumns = a.columns.filter((c) => !afterCols.has(c.name));
    const changedColumns: ColumnChange[] = [];
    for (const c of b.columns) {
      const prev = beforeCols.get(c.name);
      if (prev && colChanged(prev, c)) changedColumns.push({ name: c.name, from: prev, to: c });
    }
    if (addedColumns.length || removedColumns.length || changedColumns.length) {
      diffs.push({ key, schema: b.schema, name: b.name, status: "changed", addedColumns, removedColumns, changedColumns });
    }
  }
  return diffs.sort((x, y) => x.key.localeCompare(y.key));
}
