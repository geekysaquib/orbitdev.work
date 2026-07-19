// Dummy-data generator for a connected Postgres database. Introspects tables,
// keys and constraints, then inserts realistic-looking rows in FK-dependency
// order, reporting progress as it goes. Never deletes or modifies existing rows.
import { faker } from "@faker-js/faker";
import Anthropic from "@anthropic-ai/sdk";

export const MAX_ROWS_PER_TABLE = 1000;
const BATCH_SIZE = 200;
const NULL_CHANCE = 0.1;
const HINT_MODEL = "claude-opus-4-8";
const MAX_HINT_COLUMNS = 400;

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;
const tableKey = (t) => `${t.schema}.${t.name}`;
const columnKey = (t, c) => `${t.schema}.${t.name}.${c.name}`;
const serializeKey = (v) => (v && typeof v === "object" ? JSON.stringify(v) : String(v));
const truncate = (s, max) => (max && s.length > max ? s.slice(0, max) : s);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- CHECK constraint mining: pg_get_constraintdef renders things like
// CHECK (((status)::text = ANY ((ARRAY['paid'::character varying, ...])::text[])))
// or CHECK ((price > (0)::numeric)) — pull out allow-lists and numeric bounds
// per column so generated values don't blindly violate them. ----
function parseCheckValues(def, columnName) {
  const col = escapeRe(columnName);
  const values = [];
  const anyRe = new RegExp(`\\(?"?${col}"?\\)?(?:::[\\w\\s]+)?\\s*=\\s*ANY\\s*\\(+\\s*ARRAY\\[([^\\]]*)\\]`, "gi");
  const inRe = new RegExp(`\\(?"?${col}"?\\)?(?:::[\\w\\s]+)?\\s+IN\\s*\\(([^)]*)\\)`, "gi");
  for (const re of [anyRe, inRe]) {
    let m;
    while ((m = re.exec(def))) {
      for (const item of m[1].split(",")) {
        const strMatch = item.match(/'((?:[^']|'')*)'/);
        if (strMatch) { values.push(strMatch[1].replace(/''/g, "'")); continue; }
        const numMatch = item.match(/-?\d+(?:\.\d+)?/);
        if (numMatch) values.push(Number(numMatch[0]));
      }
    }
  }
  return values;
}

function parseCheckBounds(def, columnName) {
  const col = escapeRe(columnName);
  const cmpRe = new RegExp(`\\(?"?${col}"?\\)?(?:::[\\w\\s]+)?\\s*(>=|<=|>|<)\\s*\\(?(-?\\d+(?:\\.\\d+)?)\\)?`, "gi");
  let min, minStrict = false, max, maxStrict = false;
  let m;
  while ((m = cmpRe.exec(def))) {
    const op = m[1];
    const val = Number(m[2]);
    if (op === ">=" || op === ">") {
      if (min === undefined || val > min) { min = val; minStrict = op === ">"; }
    } else {
      if (max === undefined || val < max) { max = val; maxStrict = op === "<"; }
    }
  }
  return min === undefined && max === undefined ? null : { min, minStrict, max, maxStrict };
}

function applyCheckConstraints(column, defs) {
  if (!defs || !defs.length) return;
  const values = new Set();
  for (const def of defs) for (const v of parseCheckValues(def, column.name)) values.add(v);
  if (values.size) { column.checkValues = [...values]; return; }
  let bounds = null;
  for (const def of defs) {
    const b = parseCheckBounds(def, column.name);
    if (!b) continue;
    bounds = bounds || {};
    if (b.min !== undefined && (bounds.min === undefined || b.min > bounds.min)) { bounds.min = b.min; bounds.minStrict = b.minStrict; }
    if (b.max !== undefined && (bounds.max === undefined || b.max < bounds.max)) { bounds.max = b.max; bounds.maxStrict = b.maxStrict; }
  }
  if (!bounds) return;
  const isInt = /integer|smallint|bigint/.test(column.dataType);
  const scaleUnit = isInt ? 1 : Math.pow(10, -(column.numericScale ?? 2));
  if (bounds.min !== undefined) column.checkMin = bounds.minStrict ? bounds.min + scaleUnit : bounds.min;
  if (bounds.max !== undefined) column.checkMax = bounds.maxStrict ? bounds.max - scaleUnit : bounds.max;
}

// ---- Schema introspection (richer than the ER-diagram's /pg/schema — needs
// raw types/lengths/enum labels to generate valid values, not just display them) ----
export async function getSeedSchema(client) {
  const colsQ = client.query(
    `SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable,
            c.column_default, c.is_identity, c.character_maximum_length, c.numeric_precision, c.numeric_scale
     FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema NOT IN ('pg_catalog','information_schema') AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_schema, c.table_name, c.ordinal_position`
  );
  const pkQ = client.query(
    `SELECT tc.table_schema, tc.table_name, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema NOT IN ('pg_catalog','information_schema')
     ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position`
  );
  const uniqQ = client.query(
    `SELECT tc.table_schema, tc.table_name, tc.constraint_name, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema NOT IN ('pg_catalog','information_schema')
     ORDER BY tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position`
  );
  // pg_constraint (not information_schema) so composite FKs collapse to one edge, matching /pg/schema in server.mjs.
  const fkQ = client.query(
    `SELECT con.conname AS constraint_name,
            ns.nspname AS table_schema, tbl.relname AS table_name, att.attname AS column_name,
            fns.nspname AS ref_schema, ftbl.relname AS ref_table, fatt.attname AS ref_column,
            ord.ordinality AS position
     FROM pg_constraint con
     JOIN pg_class tbl ON tbl.oid = con.conrelid
     JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
     JOIN pg_class ftbl ON ftbl.oid = con.confrelid
     JOIN pg_namespace fns ON fns.oid = ftbl.relnamespace
     JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ord(attnum, ordinality) ON true
     JOIN pg_attribute att ON att.attnum = ord.attnum AND att.attrelid = tbl.oid
     JOIN pg_attribute fatt ON fatt.attnum = con.confkey[ord.ordinality] AND fatt.attrelid = ftbl.oid
     WHERE con.contype = 'f' AND ns.nspname NOT IN ('pg_catalog','information_schema')
     ORDER BY table_schema, table_name, constraint_name, ord.ordinality`
  );
  const enumQ = client.query(
    `SELECT t.typname AS name, e.enumlabel AS label
     FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
     ORDER BY t.typname, e.enumsortorder`
  );
  // CHECK constraints — mined for enum-like allow-lists and numeric ranges so
  // generated values don't violate constraints the heuristics can't guess
  // (e.g. CHECK (status IN (...)) or CHECK (price > 0)).
  const checkQ = client.query(
    `SELECT ns.nspname AS table_schema, tbl.relname AS table_name, pg_get_constraintdef(con.oid) AS definition
     FROM pg_constraint con
     JOIN pg_class tbl ON tbl.oid = con.conrelid
     JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
     WHERE con.contype = 'c' AND ns.nspname NOT IN ('pg_catalog','information_schema')`
  );

  const [cols, pks, uniqs, fks, enums, checks] = await Promise.all([colsQ, pkQ, uniqQ, fkQ, enumQ, checkQ]);

  const enumMap = new Map();
  for (const r of enums.rows) (enumMap.get(r.name) || enumMap.set(r.name, []).get(r.name)).push(r.label);

  const checkDefsByTable = new Map();
  for (const r of checks.rows) {
    const k = `${r.table_schema}.${r.table_name}`;
    (checkDefsByTable.get(k) || checkDefsByTable.set(k, []).get(k)).push(r.definition);
  }

  const pkColsByTable = new Map();
  for (const r of pks.rows) {
    const k = `${r.table_schema}.${r.table_name}`;
    (pkColsByTable.get(k) || pkColsByTable.set(k, []).get(k)).push(r.column_name);
  }
  const pkSet = new Set(pks.rows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`));

  const uniqConstraints = new Map(); // constraint key -> {tableKey, cols[]}
  for (const r of uniqs.rows) {
    const ck = `${r.table_schema}.${r.table_name}.${r.constraint_name}`;
    const entry = uniqConstraints.get(ck) || { tableKey: `${r.table_schema}.${r.table_name}`, cols: [] };
    entry.cols.push(r.column_name);
    uniqConstraints.set(ck, entry);
  }
  const singleUniqueByTable = new Map(); // tableKey -> Set(column) for single-column UNIQUE constraints
  for (const { tableKey: tk, cols: ucols } of uniqConstraints.values()) {
    if (ucols.length !== 1) continue;
    (singleUniqueByTable.get(tk) || singleUniqueByTable.set(tk, new Set()).get(tk)).add(ucols[0]);
  }

  const fkMap = new Map();
  for (const r of fks.rows) {
    const key = `${r.table_schema}.${r.table_name}.${r.constraint_name}`;
    const fk = fkMap.get(key) || { schema: r.table_schema, table: r.table_name, columns: [], refSchema: r.ref_schema, refTable: r.ref_table, refColumns: [] };
    fk.columns.push(r.column_name);
    fk.refColumns.push(r.ref_column);
    fkMap.set(key, fk);
  }
  const foreignKeys = [...fkMap.values()];

  const tableMap = new Map();
  for (const c of cols.rows) {
    const key = `${c.table_schema}.${c.table_name}`;
    const t = tableMap.get(key) || { schema: c.table_schema, name: c.table_name, columns: [] };
    t.columns.push({
      name: c.column_name, dataType: c.data_type, udtName: c.udt_name,
      nullable: c.is_nullable === "YES", default: c.column_default, isIdentity: c.is_identity === "YES",
      maxLength: c.character_maximum_length, numericScale: c.numeric_scale,
      isPrimaryKey: pkSet.has(`${key}.${c.column_name}`),
    });
    tableMap.set(key, t);
  }

  const tables = [...tableMap.values()].map((t) => {
    const key = tableKey(t);
    const uniques = singleUniqueByTable.get(key) || new Set();
    const tableFks = foreignKeys.filter((fk) => fk.schema === t.schema && fk.table === t.name);
    const fkColSet = new Set(tableFks.flatMap((fk) => fk.columns));
    const checkDefs = checkDefsByTable.get(key);
    return {
      schema: t.schema, name: t.name,
      primaryKey: pkColsByTable.get(key) || [],
      foreignKeys: tableFks,
      columns: t.columns.map((c) => {
        const column = {
          ...c,
          isForeignKey: fkColSet.has(c.name),
          isUnique: uniques.has(c.name),
          enumLabels: c.dataType === "USER-DEFINED" ? enumMap.get(c.udtName) || null : null,
        };
        applyCheckConstraints(column, checkDefs);
        return column;
      }),
    };
  });

  return { tables, foreignKeys };
}

// ---- Insert order: parents before children. Self-FKs are always nulled out
// (avoids the "which row goes first" bootstrap problem); unresolved cycles
// across 2+ tables just fall back to declaration order rather than failing. ----
export function planSeedOrder(tables) {
  const byKey = new Map(tables.map((t) => [tableKey(t), t]));
  const deps = new Map(tables.map((t) => [tableKey(t), new Set()]));
  for (const t of tables) {
    const key = tableKey(t);
    for (const fk of t.foreignKeys) {
      const refKey = `${fk.refSchema}.${fk.refTable}`;
      if (refKey === key || !byKey.has(refKey)) continue;
      deps.get(key).add(refKey);
    }
  }
  const order = [];
  const done = new Set();
  const visiting = new Set();
  function visit(key) {
    if (done.has(key) || visiting.has(key)) return;
    visiting.add(key);
    for (const dep of deps.get(key)) visit(dep);
    visiting.delete(key);
    done.add(key);
    order.push(key);
  }
  for (const key of deps.keys()) visit(key);
  return order.map((k) => byKey.get(k));
}

// ---- Value generation ----
function heuristicValue(col) {
  const name = col.name.toLowerCase();
  const type = col.dataType;
  if (col.enumLabels && col.enumLabels.length) return faker.helpers.arrayElement(col.enumLabels);
  if (col.checkValues && col.checkValues.length) return faker.helpers.arrayElement(col.checkValues);
  if (col.hintValues && col.hintValues.length) return faker.helpers.arrayElement(col.hintValues);
  if (/^(is_|has_|can_|should_)/.test(name) || type === "boolean") return faker.datatype.boolean();

  if (/email/.test(name)) return truncate(faker.internet.email().toLowerCase(), col.maxLength);
  if (/^(first_?name)$/.test(name)) return truncate(faker.person.firstName(), col.maxLength);
  if (/^(last_?name)$/.test(name)) return truncate(faker.person.lastName(), col.maxLength);
  if (/^(full_?name|display_?name|name)$/.test(name)) return truncate(faker.person.fullName(), col.maxLength);
  if (/user_?name|handle/.test(name)) return truncate(faker.internet.username(), col.maxLength);
  if (/phone/.test(name)) return truncate(faker.phone.number(), col.maxLength);
  if (/company|organization|org_name/.test(name)) return truncate(faker.company.name(), col.maxLength);
  if (/city/.test(name)) return truncate(faker.location.city(), col.maxLength);
  if (/state|province/.test(name)) return truncate(faker.location.state(), col.maxLength);
  if (/zip|postal/.test(name)) return truncate(faker.location.zipCode(), col.maxLength);
  if (/country/.test(name)) return truncate(faker.location.country(), col.maxLength);
  if (/address/.test(name)) return truncate(faker.location.streetAddress(), col.maxLength);
  if (/avatar|photo_url|picture/.test(name)) return truncate(faker.image.avatar(), col.maxLength);
  if (/image_url/.test(name)) return truncate(faker.image.url(), col.maxLength);
  if (/url|website|link/.test(name)) return truncate(faker.internet.url(), col.maxLength);
  if (/slug/.test(name)) return truncate(faker.lorem.slug(), col.maxLength);
  if (/password|pwd/.test(name)) return truncate(faker.internet.password({ length: 20 }), col.maxLength);

  if (/(price|amount|cost|balance|total|fee|salary|revenue|pay)/.test(name) && /numeric|money|double|real/.test(type)) {
    return Number(faker.commerce.price({ min: col.checkMin ?? 1, max: col.checkMax ?? 5000, dec: col.numericScale ?? 2 }));
  }
  if (/^status$|_status$|^state$|_state$/.test(name)) return faker.helpers.arrayElement(["active", "inactive", "pending", "archived"]);
  if (/^type$|_type$|category/.test(name)) return faker.helpers.arrayElement(["standard", "premium", "basic", "custom"]);
  if (/description|bio|notes|comment|summary|about/.test(name)) return truncate(faker.lorem.sentence(), col.maxLength);
  if (/title|subject|headline/.test(name)) return truncate(faker.lorem.words({ min: 2, max: 6 }), col.maxLength);

  if (/^created_at$|^inserted_at$/.test(name)) return faker.date.past({ years: 1 });
  if (/^updated_at$|^modified_at$/.test(name)) return faker.date.recent({ days: 30 });
  if (/_at$/.test(name) && /timestamp|date/.test(type)) return faker.date.recent({ days: 60 });

  if (/^age$/.test(name)) return faker.number.int({ min: col.checkMin ?? 18, max: col.checkMax ?? 90 });
  if (/(quantity|count|qty)$/.test(name)) return faker.number.int({ min: col.checkMin ?? 0, max: col.checkMax ?? 500 });
  if (/year/.test(name)) return faker.number.int({ min: 2015, max: 2026 });
  if ((col.checkMin !== undefined || col.checkMax !== undefined) && /integer|smallint|bigint/.test(type)) {
    return faker.number.int({ min: col.checkMin ?? 0, max: col.checkMax ?? (col.checkMin ?? 0) + 10000 });
  }
  if ((col.checkMin !== undefined || col.checkMax !== undefined) && /numeric|money|double|real/.test(type)) {
    return Number(faker.number.float({ min: col.checkMin ?? 0, max: col.checkMax ?? (col.checkMin ?? 0) + 10000, fractionDigits: col.numericScale ?? 2 }));
  }
  return null;
}

function typeDefault(col) {
  const type = col.dataType;
  if (type === "boolean") return faker.datatype.boolean();
  if (type === "uuid") return faker.string.uuid();
  if (/integer|smallint|bigint/.test(type)) return faker.number.int({ min: col.checkMin ?? 1, max: col.checkMax ?? 100000 });
  if (/numeric|double precision|real|money/.test(type)) return Number(faker.number.float({ min: col.checkMin ?? 0, max: col.checkMax ?? 10000, fractionDigits: col.numericScale ?? 2 }));
  if (/timestamp|^date$/.test(type)) return faker.date.recent({ days: 90 });
  if (/^time /.test(type)) return faker.date.recent().toTimeString().slice(0, 8);
  if (type === "json" || type === "jsonb") return {};
  if (/character varying|character|text/.test(type)) return truncate(faker.lorem.words({ min: 1, max: 3 }), col.maxLength);
  return faker.lorem.word();
}

const baseGenerate = (col) => heuristicValue(col) ?? typeDefault(col);

function makeUnique(value, used, col) {
  if (!used.has(serializeKey(value))) return value;
  for (let i = 0; i < 20; i++) {
    const candidate = typeof value === "number"
      ? value + faker.number.int({ min: 1, max: 100000 })
      : truncate(`${value}-${faker.string.alphanumeric(6)}`, col.maxLength);
    if (!used.has(serializeKey(candidate))) return candidate;
  }
  return `${value}-${faker.string.uuid()}`;
}

// Integer PK/unique columns without a DB default need real, increasing values —
// seed a counter from the current max so we never collide with existing rows.
async function prepareCounters(client, table, ctx) {
  const candidates = table.columns.filter(
    (c) => ((c.isPrimaryKey && !c.default && !c.isIdentity) || (c.isUnique && !c.default)) && /integer|smallint|bigint/.test(c.dataType)
  );
  for (const c of candidates) {
    const key = columnKey(table, c);
    if (ctx.counters.has(key)) continue;
    try {
      const r = await client.query(`SELECT COALESCE(MAX(${quoteIdent(c.name)}), 0)::bigint AS m FROM ${quoteIdent(table.schema)}.${quoteIdent(table.name)}`);
      ctx.counters.set(key, Number(r.rows[0].m) || 0);
    } catch { ctx.counters.set(key, 0); }
    if (!ctx.usedValues.has(key)) ctx.usedValues.set(key, new Set());
  }
}

function nextForColumn(ctx, table, col) {
  const key = columnKey(table, col);
  const used = ctx.usedValues.get(key) || (ctx.usedValues.set(key, new Set()).get(key));
  if (ctx.counters.has(key)) {
    const next = ctx.counters.get(key) + 1;
    ctx.counters.set(key, next);
    used.add(String(next));
    return next;
  }
  if (col.dataType === "uuid") {
    let v = faker.string.uuid();
    while (used.has(v)) v = faker.string.uuid();
    used.add(v);
    return v;
  }
  const v = makeUnique(baseGenerate(col), used, col);
  used.add(serializeKey(v));
  return v;
}

/** Builds one row, or returns null if a required FK can't be satisfied (parent table has no rows yet). */
function buildRow(table, ctx) {
  const row = {};
  for (const fk of table.foreignKeys) {
    const isSelf = fk.refSchema === table.schema && fk.refTable === table.name;
    if (isSelf) { for (const cn of fk.columns) row[cn] = null; continue; }
    const nullableAll = fk.columns.every((cn) => table.columns.find((c) => c.name === cn)?.nullable);
    const pool = ctx.pkPool.get(`${fk.refSchema}.${fk.refTable}`);
    if (!pool || pool.length === 0) {
      if (nullableAll) { for (const cn of fk.columns) row[cn] = null; continue; }
      return null;
    }
    const tuple = faker.helpers.arrayElement(pool);
    fk.columns.forEach((cn, i) => { row[cn] = tuple[fk.refColumns[i]]; });
  }
  for (const col of table.columns) {
    if (col.name in row) continue;
    if (col.isPrimaryKey && (col.default || col.isIdentity)) continue; // let Postgres generate it
    if (col.isPrimaryKey || col.isUnique) { row[col.name] = nextForColumn(ctx, table, col); continue; }
    if (!col.nullable) { row[col.name] = baseGenerate(col); continue; }
    row[col.name] = Math.random() < NULL_CHANCE ? null : baseGenerate(col);
  }
  return row;
}

async function insertBatch(client, table, rows) {
  if (rows.length === 0) return [];
  const columns = Object.keys(rows[0]);
  const valuesSql = [];
  const params = [];
  let p = 1;
  for (const row of rows) {
    valuesSql.push(`(${columns.map(() => `$${p++}`).join(",")})`);
    for (const c of columns) params.push(row[c]);
  }
  const returning = table.returningColumns.length ? ` RETURNING ${table.returningColumns.map(quoteIdent).join(",")}` : "";
  const sql = `INSERT INTO ${quoteIdent(table.schema)}.${quoteIdent(table.name)} (${columns.map(quoteIdent).join(",")}) VALUES ${valuesSql.join(",")} ON CONFLICT DO NOTHING${returning}`;
  const res = await client.query(sql, params);
  return res.rows || [];
}

// ---- Optional project-aware value hints: one LLM call (not per-row) asks for
// domain-specific sample values for columns the name-based heuristics can only
// guess at generically (e.g. "cuisine" on a food app, "genre" on a media app).
// Best-effort — any failure here just means the run falls back to heuristics. ----
function candidateHintColumns(tables) {
  const candidates = [];
  outer: for (const t of tables) {
    for (const c of t.columns) {
      if (c.isPrimaryKey || c.isForeignKey) continue;
      if ((c.enumLabels && c.enumLabels.length) || (c.checkValues && c.checkValues.length)) continue;
      if (c.dataType === "boolean" || /timestamp|^date$|^time /.test(c.dataType)) continue;
      if (!/character varying|character|^text$|numeric|integer|smallint|bigint|double precision|real|money/.test(c.dataType)) continue;
      candidates.push({ key: `${t.schema}.${t.name}.${c.name}`, table: `${t.schema}.${t.name}`, column: c.name, type: c.dataType });
      if (candidates.length >= MAX_HINT_COLUMNS) break outer;
    }
  }
  return candidates;
}

export async function getProjectHints(apiKey, tables, projectPrompt) {
  const candidates = candidateHintColumns(tables);
  if (!candidates.length) return null;

  const schemaSummary = candidates.map((c) => `${c.table}.${c.column} (${c.type})`).join("\n");
  const prompt = `A user is seeding dummy data into a Postgres database for this project:\n\n"""${projectPrompt.trim().slice(0, 2000)}"""\n\n` +
    `Below are columns from the database schema that could use domain-specific sample values instead of generic placeholder text/numbers, so the seeded data actually matches what this project is about:\n\n${schemaSummary}\n\n` +
    `For columns where realistic, on-topic values would meaningfully improve the seed data (e.g. a "cuisine" column on a food app, a "genre" column on a media app, a "role" column matching this project's domain), return a JSON object mapping "schema.table.column" to an array of 8-20 short example values appropriate for that column and this project. Use realistic short strings for text columns, or realistic numbers for numeric columns. Skip columns that are already fine with generic data (free-form descriptions, notes, addresses, names, emails, URLs, and the like) — only include columns you're confident deserve project-specific values. Respond with JSON only, no other text, no markdown fences.`;

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: HINT_MODEL,
    max_tokens: 8000,
    output_config: { effort: "medium" },
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) return null;
  const jsonText = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let parsed;
  try { parsed = JSON.parse(jsonText); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;

  const validKeys = new Set(candidates.map((c) => c.key));
  const hints = new Map();
  for (const [key, values] of Object.entries(parsed)) {
    if (!validKeys.has(key) || !Array.isArray(values) || !values.length) continue;
    hints.set(key, values.filter((v) => typeof v === "string" || typeof v === "number"));
  }
  return hints.size ? hints : null;
}

function applyProjectHints(tables, hints) {
  for (const t of tables) {
    for (const c of t.columns) {
      const values = hints.get(`${t.schema}.${t.name}.${c.name}`);
      if (values && values.length) c.hintValues = values;
    }
  }
}

export async function runSeedJob({ client, rowsPerTable, excludeTables = [], onProgress, isCancelled, projectPrompt, aiApiKey }) {
  const { tables, foreignKeys } = await getSeedSchema(client);
  const excludeSet = new Set(excludeTables.map((t) => `${t.schema}.${t.name}`));
  const activeTables = tables.filter((t) => !excludeSet.has(tableKey(t)));

  if (aiApiKey && projectPrompt && projectPrompt.trim()) {
    try {
      const hints = await getProjectHints(aiApiKey, activeTables, projectPrompt);
      if (hints) applyProjectHints(activeTables, hints);
    } catch { /* best-effort — heuristics alone still produce valid data */ }
  }

  // A table's RETURNING list must cover every column any other table's FK points at
  // (almost always its PK, but Postgres allows FKs onto any unique constraint).
  for (const t of activeTables) {
    const refCols = new Set(t.primaryKey);
    for (const fk of foreignKeys) if (fk.refSchema === t.schema && fk.refTable === t.name) fk.refColumns.forEach((c) => refCols.add(c));
    t.returningColumns = [...refCols];
  }

  const order = planSeedOrder(activeTables);
  const rows = Math.min(Math.max(1, Number(rowsPerTable) || 0), MAX_ROWS_PER_TABLE);
  const ctx = { pkPool: new Map(), usedValues: new Map(), counters: new Map() };
  const overallTotal = order.length * rows;
  let overallDone = 0;
  const inserted = {};
  const skipped = [];

  for (const table of order) {
    if (isCancelled()) break;
    const key = tableKey(table);
    await prepareCounters(client, table, ctx);
    const poolArr = ctx.pkPool.get(key) || (ctx.pkPool.set(key, []).get(key));

    let tableDone = 0;
    let batch = [];
    let reason = null;
    for (let i = 0; i < rows; i++) {
      if (isCancelled()) break;
      const row = buildRow(table, ctx);
      if (row === null) { reason = "a required foreign key points to a table with no rows to reference"; break; }
      batch.push(row);
      if (batch.length >= BATCH_SIZE || i === rows - 1) {
        try {
          const returned = await insertBatch(client, table, batch);
          for (const r of returned) poolArr.push(r);
          tableDone += batch.length;
          overallDone += batch.length;
        } catch (e) {
          // Batch insert is all-or-nothing — one bad row (e.g. a constraint the
          // heuristics couldn't infer) would otherwise wipe out the whole batch
          // and, via empty FK pools, cascade into every table that depends on
          // this one. Retry row-by-row so only the actual offenders are dropped.
          let batchInserted = 0;
          let lastError = e;
          for (const singleRow of batch) {
            try {
              const returned = await insertBatch(client, table, [singleRow]);
              for (const r of returned) poolArr.push(r);
              batchInserted++;
            } catch (rowErr) { lastError = rowErr; }
          }
          tableDone += batchInserted;
          overallDone += batchInserted;
          const failedCount = batch.length - batchInserted;
          if (failedCount > 0) {
            reason = batchInserted === 0
              ? `insert failed: ${String(lastError.message || lastError).slice(0, 200)}`
              : `${failedCount} row(s) skipped: ${String(lastError.message || lastError).slice(0, 200)}`;
          }
        }
        batch = [];
        onProgress({ table: key, tableDone, tableTotal: rows, overallDone, overallTotal });
      }
    }
    inserted[key] = tableDone;
    if (reason) skipped.push({ table: key, reason });
  }

  return { inserted, skipped, cancelled: isCancelled() };
}
