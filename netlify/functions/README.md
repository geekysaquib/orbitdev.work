# Netlify functions

`zoho-sprints.ts` proxies **Zoho Sprints** so the client secret / refresh token stay
server-side. It resolves team → project → sprints → items and returns flat work items.

`zoho-exchange.ts` does the Zoho Self Client "grant code → refresh token" exchange
server-side, so connecting Zoho in Settings never needs a terminal/curl — the Settings
UI posts Client ID / Secret / grant code here and gets a refresh token back. It only
requires a valid ORBIT session (verified against `SUPABASE_JWT_SECRET`); it doesn't
touch Supabase itself, it's a stateless proxy to Zoho's token endpoint (which blocks
browser CORS, hence doing it server-side).

Credentials are **per-account only** — read from the caller's own row in Supabase's
`integrations` table (via their JWT + RLS), entered in ORBIT → Settings → Zoho Sprints.
There is deliberately no environment-variable fallback: a signed-in user with nothing
configured gets a "not configured" error, never another account's Zoho data. Each
person still creates their own Self Client in the Zoho API Console (that step is
Zoho's, unavoidable), but everything after — the token exchange — happens in Settings:
- Client ID / Client Secret / grant code → **Exchange for tokens** fills in the
  Refresh Token automatically
- Data center (`in`, `com`, `eu`, `com.au`, `jp`, `sa`, `com.cn`)
- optional: Team ID, Project ID (pin these once known, otherwise auto-discovered)

**Scopes** (Self Client → Generate Code) — also shown with a copy button in Settings:
`ZohoSprints.teams.READ,ZohoSprints.projects.READ,ZohoSprints.sprints.READ,ZohoSprints.items.READ`

The JSON response includes `meta.sampleKeys` on the first run — the real item field
names in your workspace. If `subject`/`status`/`priority` come back blank, add the
correct key to the matching `pick([...])` list in `zoho-sprints.ts`.

Install the functions runtime types locally: `npm i -D @netlify/functions`.
