# ORBIT local agent

Headless background service that gives the browser hands: it launches VS Code,
Visual Studio, terminals, and browsers, and runs your Start/End-Work macros.

```bash
cd agent
npm install
npm start          # http://localhost:47600
```

The ORBIT web app calls `VITE_AGENT_URL` (default `https://localhost:47600`).
For a Netlify (HTTPS) page → localhost without mixed-content warnings, serve the
agent over HTTPS with a locally-trusted cert:

```bash
mkcert -install
mkcert localhost 127.0.0.1
# then wrap the app in https.createServer({ key, cert }, app)
```

Prefer .NET? Swap this Node service for a .NET minimal API exposing the same
`/ping`, `/launch`, `/macro` endpoints — the web app doesn't care which runs.
