// Confirms the timesheet response shape. Needs the NEW refresh token (timesheets scope) in .env.
// Run from project root:  node probe-timesheet2.mjs [projectId]
import { readFileSync } from "node:fs";
try { for (const l of readFileSync(".env","utf8").split("\n")) { const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\r\n]*)/); if(m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g,"").trim(); } } catch { console.log("run from project root"); process.exit(1); }
const DC=process.env.ZOHO_DC||"in", TEAM=process.env.ZOHO_TEAM_ID, PROJECT=process.argv[2]||process.env.ZOHO_PROJECT_ID;
const API=`https://sprintsapi.zoho.${DC}/zsapi`;
async function tok(){const b=new URLSearchParams({refresh_token:process.env.ZOHO_REFRESH_TOKEN,client_id:process.env.ZOHO_CLIENT_ID,client_secret:process.env.ZOHO_CLIENT_SECRET,grant_type:"refresh_token"});const j=await(await fetch(`https://accounts.zoho.${DC}/oauth/v2/token`,{method:"POST",body:b})).json();if(!j.access_token){console.log("!! token fail:",JSON.stringify(j));process.exit(1);}return j.access_token;}
const T=await tok(), H={Authorization:"Zoho-oauthtoken "+T}, base=`${API}/team/${TEAM}/projects/${PROJECT}`;
const tries=[
  ["timesheet action=data",  `${base}/timesheet/?action=data`],
  ["timesheet action=logs",  `${base}/timesheet/?action=logs`],
  ["timesheet action=detail",`${base}/timesheet/?action=detail`],
  ["timesheet no action",    `${base}/timesheet/`],
  ["logtime action=data",    `${base}/logtime/?action=data`],
];
for (const [lbl,url] of tries){ try{ const r=await fetch(url,{headers:H}); console.log(`\n[${lbl}] ${r.status}\n${(await r.text()).slice(0,500)}`);}catch(e){console.log(`[${lbl}] ERR`,e.message);} }
