// Finds the status & priority definition endpoints so IDs can become names.
// PowerShell:  $env:TOKEN="..."; $env:PROJECT="45354000001026097"; node probe-settings.mjs
const T = process.env.TOKEN;
const TEAM = process.env.TEAM || "60069474422";
const PROJECT = process.env.PROJECT;
const base = `https://sprintsapi.zoho.in/zsapi/team/${TEAM}/projects/${PROJECT}`;
const H = { Authorization: "Zoho-oauthtoken " + T };

const tries = [
  ["itemstatus", `${base}/itemstatus/?action=data`],
  ["status",     `${base}/status/?action=data`],
  ["priority",   `${base}/priority/?action=data`],
  ["priorities", `${base}/priorities/?action=data`],
  ["itemtype",   `${base}/itemtype/?action=data`],
  ["settings",   `${base}/settings/?action=data`],
];
for (const [label, url] of tries) {
  try {
    const r = await fetch(url, { headers: H });
    const txt = await r.text();
    console.log(`\n[${label}] ${r.status}\n${txt.slice(0, 300)}`);
  } catch (e) { console.log(`\n[${label}] ERR ${e.message}`); }
}
