// Prints the real item field names + first item's values.
// PowerShell:  $env:TOKEN="..."; $env:PROJECT="45354000001026097"; node probe-items.mjs
const T = process.env.TOKEN;
const TEAM = process.env.TEAM || "60069474422";
const PROJECT = process.env.PROJECT;
const base = `https://sprintsapi.zoho.in/zsapi/team/${TEAM}/projects/${PROJECT}`;
const H = { Authorization: "Zoho-oauthtoken " + T };

const s = await (await fetch(`${base}/sprints/?action=data&type=%5B1,2,3,4%5D`, { headers: H })).json();
const sprintId = (s.sprintIds || [])[0];
console.log("using sprintId:", sprintId);

const it = await (await fetch(`${base}/sprints/${sprintId}/item/?action=sprintitems&subitem=true`, { headers: H })).json();
const prop = it.item_prop || {};
const ids = it.itemIds || [];
console.log("\nitem_prop keys:\n", Object.keys(prop).join(", "));
if (ids.length) {
  const vals = it.itemJObj[ids[0]];
  const rec = {}; for (const k in prop) rec[k] = vals[prop[k]];
  console.log("\nfirst item unfurled:\n", JSON.stringify(rec, null, 2));
} else {
  console.log("\n(no items in this sprint — try another PROJECT or check a sprint that has items)");
}
