// Checks whether Zoho attachment image bytes are fetchable server-side with the OAuth token.
// Run from project root:  node probe-img.mjs
import { readFileSync } from "node:fs";
try { for (const l of readFileSync(".env","utf8").split("\n")) { const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\r\n]*)/); if(m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g,"").trim(); } } catch { console.log("run from project root"); process.exit(1); }
const DC=process.env.ZOHO_DC||"in", TEAM=process.env.ZOHO_TEAM_ID, PROJECT=process.env.ZOHO_PROJECT_ID;
const API=`https://sprintsapi.zoho.${DC}/zsapi`;
async function tok(){const b=new URLSearchParams({refresh_token:process.env.ZOHO_REFRESH_TOKEN,client_id:process.env.ZOHO_CLIENT_ID,client_secret:process.env.ZOHO_CLIENT_SECRET,grant_type:"refresh_token"});const j=await(await fetch(`https://accounts.zoho.${DC}/oauth/v2/token`,{method:"POST",body:b})).json();if(!j.access_token){console.log("token fail:",JSON.stringify(j));process.exit(1);}return j.access_token;}
const T=await tok(), H={Authorization:"Zoho-oauthtoken "+T}, j=(u)=>fetch(u,{headers:H}).then(r=>r.json());
const base=`${API}/team/${TEAM}/projects/${PROJECT}`;
// find an image attachment
const s=await j(`${base}/sprints/?action=data&type=%5B1,2,3,4%5D`);
let found=null;
for (const sid of (s.sprintIds||[])){ const it=await j(`${base}/sprints/${sid}/item/?action=sprintitems&subitem=true`); const p=it.item_prop||{};
  for (const iid of (it.itemIds||[])){ if(it.itemJObj[iid][p.isDocsAdded]===true){ const a=await j(`${base}/sprints/${sid}/item/${iid}/attachments/?action=notes`); const arr=a.itemAttachments?.[iid]||[]; const img=arr.find(x=>/png|jpe?g|gif|webp/i.test(x.EXTENSION||"")); if(img){found={img};break;} } }
  if(found)break; }
if(!found){console.log("no image attachment found");process.exit(0);}
const a=found.img;
console.log("resource:", a.RESOURCE_ID, a.EXTENSION);
for (const [lbl,url] of [["THUMBNAIL_URL",a.THUMBNAIL_URL],["DOWNLOAD_URL",a.DOWNLOAD_URL],["ORIG_URL",a.ORIG_URL]]) {
  if(!url){console.log(`[${lbl}] (none)`);continue;}
  try{
    // try WITH oauth header
    const r=await fetch(url,{headers:H,redirect:"follow"});
    const ct=r.headers.get("content-type"); const buf=Buffer.from(await r.arrayBuffer());
    console.log(`[${lbl}] auth: ${r.status} ct=${ct} bytes=${buf.length} ${buf.slice(0,8).toString("hex")}`);
    // try WITHOUT header
    const r2=await fetch(url,{redirect:"follow"});
    console.log(`   noauth: ${r2.status} ct=${r2.headers.get("content-type")}`);
  }catch(e){console.log(`[${lbl}] ERR`,e.message);}
}
