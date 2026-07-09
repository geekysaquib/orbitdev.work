# Netlify functions

`zoho-sprints.ts` proxies **Zoho Sprints** so the client secret / refresh token stay
server-side. It resolves team → project → sprints → items and returns flat work items.

Credentials are **per-account only** — read from the caller's own row in Supabase's
`integrations` table (via their JWT + RLS), entered in ORBIT → Settings → Zoho Sprints.
There is deliberately no environment-variable fallback: a signed-in user with nothing
configured gets a "not configured" error, never another account's Zoho data. Each
person generates their own Self Client credentials in the Zoho API Console and pastes
them in:
- Client ID / Client Secret / Refresh Token (Self Client → grant code → token exchange)
- Data center (`in`, `com`, `eu`, `com.au`, `jp`, `sa`, `com.cn`)
- optional: Team ID, Project ID (pin these once known, otherwise auto-discovered)

**Scopes** (Self Client → Generate Code):
`ZohoSprints.teams.READ,ZohoSprints.projects.READ,ZohoSprints.sprints.READ,ZohoSprints.items.READ`

The JSON response includes `meta.sampleKeys` on the first run — the real item field
names in your workspace. If `subject`/`status`/`priority` come back blank, add the
correct key to the matching `pick([...])` list in `zoho-sprints.ts`.

Install the functions runtime types locally: `npm i -D @netlify/functions`.
