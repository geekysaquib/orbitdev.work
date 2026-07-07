// Board metadata probe. Run from project root:
//   node probe-board.mjs                (uses ZOHO_PROJECT_ID from .env)
//   node probe-board.mjs 45354000001026097   (pass a project id explicitly)
import { readFileSync } from "node:fs";
try { for (const line of readFileSync(".env","utf8").split("\n")) { const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if(m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g,"").trim(); } }
catch { console.log("!! no .env found — run from D:\\orbit\\orbit"); process.exit(1); }

const DC=process.env.ZOHO_DC||"in", TEAM=process.env.ZOHO_TEAM_ID;
const PROJECT=process.argv[2]||process.env.ZOHO_PROJECT_ID;
const API=`https://sprintsapi.zoho.${DC}/zsapi`;
if(!TEAM){ console.log("!! ZOHO_TEAM_ID missing in .env"); process.exit(1); }
if(!PROJECT){ console.log("!! No project id. Pass one: node probe-board.mjs <projectId>  (or set ZOHO_PROJECT_ID in .env)"); process.exit(1); }

async function tok(){
  const b=new URLSearchParams({refresh_token:process.env.ZOHO_REFRESH_TOKEN,client_id:process.env.ZOHO_CLIENT_ID,client_secret:process.env.ZOHO_CLIENT_SECRET,grant_type:"refresh_token"});
  const j=await(await fetch(`https://accounts.zoho.${DC}/oauth/v2/token`,{method:"POST",body:b})).json();
  if(!j.access_token){ console.log("!! TOKEN REFRESH FAILED:", JSON.stringify(j)); process.exit(1); }
  return j.access_token;
}
const T=await tok(), H={Authorization:"Zoho-oauthtoken "+T}, j=(u)=>fetch(u,{headers:H}).then(r=>r.json());
const base=`${API}/team/${TEAM}/projects/${PROJECT}`;
console.log("team:",TEAM,"project:",PROJECT,"\n");

console.log("=== ITEMSTATUS (raw, first 900) ===");
const st=await j(`${base}/itemstatus/?action=data`);
console.log(JSON.stringify(st).slice(0,900));

console.log("\n=== ITEMTYPE (raw, first 700) ===");
const ty=await j(`${base}/itemtype/?action=data`);
console.log(JSON.stringify(ty).slice(0,700));

console.log("\n=== ONE ITEM DETAIL ===");
const s=await j(`${base}/sprints/?action=data&type=%5B1,2,3,4%5D`); const sid=(s.sprintIds||[])[0];
if(!sid){ console.log("no sprints:", JSON.stringify(s).slice(0,200)); process.exit(0); }
const it=await j(`${base}/sprints/${sid}/item/?action=sprintitems&subitem=true`); const iid=(it.itemIds||[])[0];
const d=await j(`${base}/sprints/${sid}/item/${iid}/?action=details`);
console.log("userDisplayName:", d.userDisplayName);
if(d.item_prop && d.itemJObj?.[iid]){ const p=d.item_prop, v=d.itemJObj[iid];
  console.log("resolved:", {name:v[p.itemName], typeId:v[p.projItemTypeId], epicId:v[p.epicId], statusId:v[p.statusId], owners:v[p.ownerId], desc:String(v[p.description]||"").slice(0,90)}); }
else console.log("detail shape:", JSON.stringify(d).slice(0,300));

console.log("\n=== ATTACHMENT endpoint probes ===");
for (const [lbl,url] of [
  ["a: item/attachment", `${base}/sprints/${sid}/item/${iid}/attachment/?action=data`],
  ["b: item/attachments",`${base}/sprints/${sid}/item/${iid}/attachments/?action=data`],
  ["c: item/docs",       `${base}/sprints/${sid}/item/${iid}/docs/?action=data`],
]) { try { const r=await fetch(url,{headers:H}); console.log(`[${lbl}] ${r.status}: ${(await r.text()).slice(0,160)}`);} catch(e){console.log(`[${lbl}] ERR`,e.message);} }
