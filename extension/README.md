# ORBIT for VS Code

Your ORBIT tasks, tickets and timer in the sidebar — plus accurate focus tracking
based on what you're actually editing.

## Why it exists

ORBIT's idle detection used to watch the browser tab, so coding heads-down in VS
Code read as "idle" and paused your timer mid-session. This extension reports the
file you're in to the local agent, so ORBIT's focus analytics and idle detection
reflect real work.

## Install (development)

```bash
cd extension
npm install
npm run build
```

Then in VS Code: **Run → Start Debugging** with this folder open, or copy it into
`~/.vscode/extensions/orbit-vscode/` and reload.

## Setup

1. Make sure the ORBIT agent is running (`cd agent && npm start`).
2. Run **ORBIT: Sign in** and paste the token from
   ORBIT → Settings → Local agent → *Copy VS Code token*.

## What it does

- **My work** sidebar — your tasks and tickets, grouped, priority-coded. Click to
  open the item in ORBIT.
- **Status bar timer** — shows elapsed minutes; click to start/stop.
- **Activity reporting** — posts active file/language/project to the agent every
  15s, only while VS Code has focus. Disable with `orbit.reportActivity`.

## Privacy

Everything goes to `http://localhost:47600` (the agent on your own machine). The
extension never contacts Supabase or any cloud service, and stores only the ORBIT
session token, in VS Code's `SecretStorage`.

## Settings

| setting | default | meaning |
| --- | --- | --- |
| `orbit.agentUrl` | `http://localhost:47600` | Local ORBIT agent |
| `orbit.webUrl` | `http://localhost:8888` | Used by "Open in ORBIT" |
| `orbit.reportActivity` | `true` | Report active file to the agent |

## Known limitation

The sidebar shows what an ORBIT tab last pushed to the agent — the agent has no
database access of its own by design. With no ORBIT tab open for a while, the tree
says so rather than presenting stale rows as current. Timer/status commands
likewise need an open tab, since the timer lives in its localStorage.
