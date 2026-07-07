// Dumps the timesheet log_prop map + one fully-resolved log entry. Run from project root.
import { readFileSync } from "node:fs";
try { for (const l of readFileSync(".env","utf8").split("\n")) { const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\r\n]*)/); if(m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g,"").trim(); } } catch { console.log("run from project root"); process.exit(1); }
const DC=process.env.ZOHO_DC||"in", TEAM=process.env.ZOHO_TEAM_ID, PROJECT=process.argv[2]||process.env.ZOHO_PROJECT_ID;
const API=`https://sprintsapi.zoho.${DC}/zsapi`;
async function tok(){const b=new URLSearchParams({refresh_token:process.env.ZOHO_REFRESH_TOKEN,client_id:process.env.ZOHO_CLIENT_ID,client_secret:process.env.ZOHO_CLIENT_SECRET,grant_type:"refresh_token"});const j=await(await fetch(`https://accounts.zoho.${DC}/oauth/v2/token`,{method:"POST",body:b})).json();if(!j.access_token){console.log("!! token fail:",JSON.stringify(j));process.exit(1);}return j.access_token;}
const T=await tok(), H={Authorization:"Zoho-oauthtoken "+T};
const j=await (await fetch(`${API}/team/${TEAM}/projects/${PROJECT}/timesheet/?action=data`,{headers:H})).json();
console.log("top-level keys:", Object.keys(j));
console.log("\n=== log_prop (field -> index) ===\n", JSON.stringify(j.log_prop || j.logs_prop || j.timesheet_prop || "(NOT FOUND - keys above)"));
const id=(j.logIds||[])[0];
if (j.log_prop && id) { const p=j.log_prop, v=j.logJObj[id], rec={}; for(const k in p) rec[k]=v[p[k]]; console.log("\n=== first log resolved ===\n", JSON.stringify(rec,null,1)); }
console.log("\n=== userDisplayName ===\n", JSON.stringify(j.userDisplayName||{}));
console.log("\n=== raw first log values ===\n", JSON.stringify(j.logJObj?.[id]||[]));
