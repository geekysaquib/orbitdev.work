// Item detail (description + attachments) + status/priority id check.
// PS: $env:TOKEN="..."; $env:PROJECT="45354000001026097"; node probe-detail.mjs
const T = process.env.TOKEN;
const TEAM = process.env.TEAM || "60069474422";
const PROJECT = process.env.PROJECT;
const base = `https://sprintsapi.zoho.in/zsapi/team/${TEAM}/projects/${PROJECT}`;
const H = { Authorization: "Zoho-oauthtoken " + T };
const j = (u) => fetch(u, { headers: H }).then(r => r.json());

// pick a sprint + first item
const s = await j(`${base}/sprints/?action=data&type=%5B1,2,3,4%5D`);
const sprintId = (s.sprintIds || [])[0];
const it = await j(`${base}/sprints/${sprintId}/item/?action=sprintitems&subitem=true`);
const itemId = (it.itemIds || [])[0];
console.log("sprintId:", sprintId, "itemId:", itemId);
console.log("\nitem-list statusId/prio of first item:",
  it.itemJObj[itemId][it.item_prop.statusId], "/", it.itemJObj[itemId][it.item_prop.projPriorityId]);

// status + priority definition IDs (to compare against the above)
const st = await j(`${base}/itemstatus/?action=data`);
console.log("\nstatus definition IDs:", Object.keys(st.statusJObj || {}));
const pr = await j(`${base}/priority/?action=data`);
console.log("priority definition IDs:", Object.keys(pr.projPriorityJObj || {}));

// ITEM DETAIL — description + attachments live here
const d = await j(`${base}/sprints/${sprintId}/item/${itemId}/?action=details`);
console.log("\n=== item detail top-level keys ===\n", Object.keys(d));
console.log("\n=== detail item_prop keys (if present) ===\n", d.item_prop ? Object.keys(d.item_prop) : "(none)");
console.log("\n=== raw detail (first 1500 chars) ===\n", JSON.stringify(d).slice(0, 1500));
