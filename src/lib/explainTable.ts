import type { PgSchema, PgSchemaTable, PgForeignKey } from "./pg";

export interface TableExplanation {
  headline: string;
  summary: string;
  facts: string[];
  outgoing: { text: string; via: string }[];
  incoming: { text: string; via: string }[];
  columns: { name: string; note: string }[];
  notes: string[];
}

const humanize = (s: string) => s.replace(/_/g, " ");
const has = (re: RegExp) => (name: string) => re.test(name);

const isStatusLike = has(/(^|_)(status|state|type|kind|category)s?$/i);
const isFlag = (name: string, type: string) => /^(is_|has_|can_|should_)/i.test(name) || /^bool/i.test(type);
const isMoney = (name: string, type: string) => /numeric|money|decimal/i.test(type) && /(price|amount|cost|balance|total|fee|salary|revenue|pay)/i.test(name)
  || /(price|amount|cost|balance|total_cents|fee_cents)/i.test(name);
const isEmail = has(/email/i);
const isTimestampish = has(/_at$|^created$|^updated$/i);
const isSoftDelete = has(/^deleted_at$|^is_deleted$|^archived_at$/i);
const isAuthy = has(/^(user|account|member|profile|admin|role|permission|session)s?$/i);
const isAuditName = has(/(^|_)(log|audit|history|event|activity)s?($|_)/i);

export function explainTable(table: PgSchemaTable, schema: PgSchema): TableExplanation {
  const outFks = schema.foreignKeys.filter((fk) => fk.schema === table.schema && fk.table === table.name);
  const inFks = schema.foreignKeys.filter(
    (fk) => fk.refSchema === table.schema && fk.refTable === table.name && !(fk.schema === table.schema && fk.table === table.name)
  );
  const selfFks = outFks.filter((fk) => fk.refSchema === table.schema && fk.refTable === table.name);
  const nonSelfOutFks = outFks.filter((fk) => !(fk.refSchema === table.schema && fk.refTable === table.name));

  const fkColNames = new Set(outFks.flatMap((fk) => fk.columns));
  const pkColNames = new Set(table.primaryKey.length ? table.primaryKey : table.columns.filter((c) => c.isPrimaryKey).map((c) => c.name));
  const nonKeyCols = table.columns.filter((c) => !fkColNames.has(c.name) && !pkColNames.has(c.name));
  const requiredCols = table.columns.filter((c) => !c.nullable);
  const isView = /view/i.test(table.type);

  const distinctRefTargets = new Set(nonSelfOutFks.map((fk) => `${fk.refSchema}.${fk.refTable}`));
  // A join table's primary key is (essentially) its foreign keys — that's what
  // distinguishes it from an entity table that merely happens to have 2+ FKs.
  const isJunction = !isView && distinctRefTargets.size >= 2 && pkColNames.size > 0
    && [...pkColNames].every((pk) => fkColNames.has(pk))
    && nonKeyCols.filter((c) => !isTimestampish(c.name)).length <= 2;
  const isLookup = !isView && outFks.length === 0 && inFks.length > 0 && table.columns.length <= 6
    && table.columns.some((c) => /^(name|label|code|title|slug|key)$/i.test(c.name));
  const isAudit = isAuditName(table.name);
  const isAuth = isAuthy(table.name);
  const softDeleteCol = table.columns.find((c) => isSoftDelete(c.name));
  const hasCreated = table.columns.some((c) => /^created_at$/i.test(c.name));
  const hasUpdated = table.columns.some((c) => /^updated_at$/i.test(c.name));

  let headline: string;
  if (isView) headline = `View — a saved query, not a stored table`;
  else if (isJunction) headline = `Junction table linking ${[...distinctRefTargets].map((k) => k.split(".").pop()).join(" and ")}`;
  else if (isLookup) headline = `Lookup / reference table`;
  else if (isAudit) headline = `Audit or event-log table`;
  else if (isAuth) headline = `Authentication / user-account table`;
  else if (selfFks.length > 0) headline = `Self-referential table (hierarchy or tree)`;
  else headline = `Core entity table`;

  const niceName = humanize(`${table.schema}.${table.name}`);
  const summaryParts: string[] = [];
  if (isView) {
    summaryParts.push(`${niceName} is a database view, computed from other tables rather than storing rows directly.`);
  } else if (isJunction) {
    summaryParts.push(`${niceName} sits between ${[...distinctRefTargets].join(" and ")}, resolving a many-to-many relationship between them.`);
  } else if (isLookup) {
    summaryParts.push(`${niceName} looks like a small reference/lookup table — other tables likely point into it to pick a fixed value.`);
  } else if (isAudit) {
    summaryParts.push(`${niceName} appears to record events or changes over time, based on its name.`);
  } else if (isAuth) {
    summaryParts.push(`${niceName} looks like it stores user, account, or access-control data.`);
  } else {
    summaryParts.push(`${niceName} is a ${nonSelfOutFks.length > 0 ? "dependent" : "standalone"} entity table with ${table.columns.length} column${table.columns.length === 1 ? "" : "s"}.`);
  }
  if (selfFks.length > 0 && !isJunction) {
    summaryParts.push(`It references itself via ${selfFks.map((fk) => fk.columns.join(", ")).join(", ")}, which usually models a parent/child or tree structure.`);
  }
  const summary = summaryParts.join(" ");

  const facts: string[] = [];
  facts.push(`${table.columns.length} column${table.columns.length === 1 ? "" : "s"} · ${requiredCols.length} required, ${table.columns.length - requiredCols.length} optional`);
  facts.push(pkColNames.size ? `Primary key: ${[...pkColNames].join(", ")}` : `No primary key defined`);
  if (nonSelfOutFks.length) facts.push(`References ${distinctRefTargets.size} other table${distinctRefTargets.size === 1 ? "" : "s"}`);
  if (inFks.length) facts.push(`Referenced by ${new Set(inFks.map((fk) => `${fk.schema}.${fk.table}`)).size} other table${new Set(inFks.map((fk) => `${fk.schema}.${fk.table}`)).size === 1 ? "" : "s"}`);
  if (hasCreated || hasUpdated) facts.push(`Tracks ${[hasCreated && "created_at", hasUpdated && "updated_at"].filter(Boolean).join(" / ")} timestamps`);
  if (softDeleteCol) facts.push(`Supports soft-delete via ${softDeleteCol.name}`);

  const outgoing = nonSelfOutFks.map((fk: PgForeignKey) => ({
    text: `${fk.refSchema}.${fk.refTable}`,
    via: `${fk.columns.join(", ")} → ${fk.refColumns.join(", ")}`,
  }));
  const incoming = inFks.map((fk: PgForeignKey) => ({
    text: `${fk.schema}.${fk.table}`,
    via: `${fk.columns.join(", ")} → ${fk.refColumns.join(", ")}`,
  }));

  const columns = table.columns
    .map((c) => {
      const bits: string[] = [];
      if (pkColNames.has(c.name)) bits.push("primary key");
      if (fkColNames.has(c.name)) {
        const fk = outFks.find((f) => f.columns.includes(c.name));
        if (fk) bits.push(`references ${fk.refSchema}.${fk.refTable}`);
      }
      if (isFlag(c.name, c.type)) bits.push("boolean flag");
      if (isStatusLike(c.name)) bits.push("categorical / enum-like");
      if (isMoney(c.name, c.type)) bits.push("monetary value");
      if (isEmail(c.name)) bits.push("email address");
      if (isTimestampish(c.name)) bits.push("timestamp");
      if (!c.nullable) bits.push("required");
      if (c.default) bits.push(`default ${c.default}`);
      return bits.length ? { name: c.name, note: bits.join(" · ") } : null;
    })
    .filter((x): x is { name: string; note: string } => !!x);

  const notes: string[] = [];
  if (!pkColNames.size) notes.push("No primary key was found — rows may not be uniquely identifiable, which can complicate replication and upserts.");
  if (isJunction) notes.push("Because this is a junction table, the interesting data usually lives in the tables it connects, not here.");
  if (softDeleteCol) notes.push(`Rows are probably never hard-deleted — filter on ${softDeleteCol.name} to exclude removed records.`);
  if (!hasCreated && !hasUpdated && !isView) notes.push("No created_at/updated_at columns — this table isn't self-auditing, so change history must live elsewhere.");
  if (requiredCols.length === table.columns.length && table.columns.length > 1) notes.push("Every column is NOT NULL — rows must be fully populated at insert time.");
  const orphanRisk = inFks.length === 0 && nonSelfOutFks.length === 0 && !isLookup && !isView;
  if (orphanRisk) notes.push("No foreign keys in or out — this table isn't connected to the rest of the schema.");

  return { headline, summary, facts, outgoing, incoming, columns, notes };
}
