# Netlify functions

`zoho-sprints.ts` proxies **Zoho Sprints** so the client secret / refresh token stay
server-side. It resolves team → project → sprints → items and returns flat work items.

Set these in **Netlify → Site settings → Environment variables** (NOT `VITE_`-prefixed):
- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`   (Self Client → grant code → token exchange)
- `ZOHO_DC`              (`in`, `com`, `eu`, `com.au`, `jp`, `sa`, `com.cn`)
- optional: `ZOHO_TEAM_ID`, `ZOHO_PROJECT_ID`, `ZOHO_PROJECT_NAME`

**Scopes** (Self Client → Generate Code):
`ZohoSprints.teams.READ,ZohoSprints.projects.READ,ZohoSprints.sprints.READ,ZohoSprints.items.READ`

The JSON response includes `meta.sampleKeys` on the first run — the real item field
names in your workspace. If `subject`/`status`/`priority` come back blank, add the
correct key to the matching `pick([...])` list in `zoho-sprints.ts`.

Install the functions runtime types locally: `npm i -D @netlify/functions`.
