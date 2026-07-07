// Finds an item with attachments and dumps the raw attachments response.
// Run from project root:  node probe-attach.mjs [projectId]
import { readFileSync } from "node:fs";
try { for (const line of readFileSync(".env","utf8").split("\n")) { const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\r\n]*)/); if(m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g,"").trim(); } } catch { console.log("run from project root"); process.exit(1); }
const DC=process.env.ZOHO_DC||"in", TEAM=process.env.ZOHO_TEAM_ID, PROJECT=process.argv[2]||process.env.ZOHO_PROJECT_ID;
const API=`https://sprintsapi.zoho.${DC}/zsapi`;
async function tok(){const b=new URLSearchParams({refresh_token:process.env.ZOHO_REFRESH_TOKEN,client_id:process.env.ZOHO_CLIENT_ID,client_secret:process.env.ZOHO_CLIENT_SECRET,grant_type:"refresh_token"});const j=await(await fetch(`https://accounts.zoho.${DC}/oauth/v2/token`,{method:"POST",body:b})).json();if(!j.access_token){console.log("!! token fail:",JSON.stringify(j));process.exit(1);}return j.access_token;}
const T=await tok(), H={Authorization:"Zoho-oauthtoken "+T}, j=(u)=>fetch(u,{headers:H}).then(r=>r.json());
const base=`${API}/team/${TEAM}/projects/${PROJECT}`;
const s=await j(`${base}/sprints/?action=data&type=%5B1,2,3,4%5D`);
let found=null;
for (const sid of (s.sprintIds||[])) {
  const it=await j(`${base}/sprints/${sid}/item/?action=sprintitems&subitem=true`);
  const p=it.item_prop||{};
  for (const iid of (it.itemIds||[])) {
    if (it.itemJObj[iid][p.isDocsAdded]===true) { found={sid,iid,name:it.itemJObj[iid][p.itemName]}; break; }
  }
  if (found) break;
}
if (!found) { console.log("No item with isDocsAdded=true found in these sprints."); process.exit(0); }
console.log("attachment item:", found.name, "| sprint", found.sid, "item", found.iid);
const raw = await j(`${base}/sprints/${found.sid}/item/${found.iid}/attachments/?action=notes`);
console.log("\n=== RAW attachments response ===\n", JSON.stringify(raw).slice(0, 1200));
