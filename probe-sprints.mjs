// Usage: set TOKEN, TEAM, PROJECT below (or via env), then: node probe-sprints.mjs
const T = process.env.TOKEN;
const TEAM = process.env.TEAM || "60069474422";
const PROJECT = process.env.PROJECT; // set this!
const base = `https://sprintsapi.zoho.in/zsapi/team/${TEAM}/projects/${PROJECT}`;
const H = { Authorization: "Zoho-oauthtoken " + T };

const tries = [
  ["encoded type",      `${base}/sprints/?action=data&type=%5B1,2,3,4%5D`],
  ["type=1",            `${base}/sprints/?action=data&type=1`],
  ["no type",           `${base}/sprints/?action=data`],
  ["index only",        `${base}/sprints/`],
  ["project details",   `${base}/?action=details`],
  ["backlog",           `${base}/?action=getbacklog`],
];

for (const [label, url] of tries) {
  try {
    const r = await fetch(url, { headers: H });
    const txt = await r.text();
    console.log(`\n[${label}] ${r.status}`);
    console.log(txt.slice(0, 240));
  } catch (e) { console.log(`\n[${label}] ERR ${e.message}`); }
}
