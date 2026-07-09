# ORBIT local agent

Headless background service that gives the browser hands: it launches VS Code,
Visual Studio, terminals, and browsers, runs your Start/End-Work macros, and
proxies Postgres/Gmail/Docker/git that the browser can't reach directly.

```bash
cd agent
npm install
npm start          # http://localhost:47600
```

## Auth (required)

Every endpoint except `/` and `/ping` requires the caller's ORBIT session
token (the same JWT `netlify/functions/auth.ts` issues on login) — the agent
verifies it and uses the `sub` claim as the user id to scope Postgres servers,
Gmail credentials, and dev-server tracking. Two people running ORBIT against
the same agent never see each other's data — except Docker, which reflects
whatever's actually running on this machine and can't be split per user.

Give the agent the **same** secret Netlify uses (`SUPABASE_JWT_SECRET` —
Supabase Project Settings → API → JWT Settings → Legacy JWT Secret), either as
an environment variable when you start it, or via a local config file:

```bash
cp agent-config.example.json agent-config.json
# then paste the secret into "jwtSecret"
```

Without this set, every authenticated request 401s and ORBIT's topbar will
still show "Agent connected" (that only checks `/ping`) even though nothing
else works — check the agent's terminal output if Docker/Postgres/Gmail
panels stay empty.

## Per-user config files (gitignored — never commit these)

- `gmail-config.json` — `{ "<user-id>": { "user": "...", "pass": "..." } }`.
- `pg-config.json` — `{ "<user-id>": [ { ...server }, ... ] }`.

No environment-variable fallback and no inheriting an old shared config —
each account's Gmail/Postgres is entirely separate, keyed by their ORBIT user
id. If either file predates per-user scoping (a flat `{ user, pass }` object or
a bare array), the agent treats it as unset rather than guessing whose it was;
add your servers/Gmail again from Settings once per account.

## HTTPS

For a Netlify (HTTPS) page → localhost without mixed-content warnings, serve the
agent over HTTPS with a locally-trusted cert:

```bash
mkcert -install
mkcert localhost 127.0.0.1
# then wrap the app in https.createServer({ key, cert }, app)
```

Prefer .NET? Swap this Node service for a .NET minimal API exposing the same
routes — the web app doesn't care which runs, as long as it verifies the same
JWT the same way.
