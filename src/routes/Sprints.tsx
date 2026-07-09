import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "../lib/icons";
import { ACCENT, prColor, Empty, OrbitLoader, SetupRequired } from "../components/ui";
import { useToast } from "../context/Toast";
import { useZoho } from "../context/Zoho";
import {
  fetchSprintProjects, fetchSprintBoard, fetchItemDetail, fetchThumbs,
  type SprintProject, type Board, type ZohoItem, type ItemDetail, type Thumb, type Attachment,
} from "../lib/zoho";

const typeStyle = (name: string): { color: string; icon: string } => {
  const n = (name || "").toLowerCase();
  if (n.includes("bug")) return { color: ACCENT.red, icon: "bolt" };
  if (n.includes("story")) return { color: ACCENT.mint, icon: "book" };
  return { color: ACCENT.blue, icon: "check2" }; // Task / default
};
const initials = (name: string) => name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const fmtSize = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
const isImage = (a: Attachment) => /^(png|jpe?g|gif|webp|bmp|svg)$/i.test(a.ext || "") || (a.contentType || "").toLowerCase().includes("image");
const isVideo = (a: Attachment) => /^(mp4|webm|ogg|mov|m4v)$/i.test(a.ext || "") || (a.contentType || "").toLowerCase().includes("video");

export default function Sprints() {
  const toast = useToast();
  const zoho = useZoho();
  const [projects, setProjects] = useState<SprintProject[]>([]);
  const [loadingP, setLoadingP] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [loadingB, setLoadingB] = useState(false);
  const [sprintIdx, setSprintIdx] = useState(0);
  const [open, setOpen] = useState<{ sprintId: string; itemId: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, Thumb>>({});
  const [query, setQuery] = useState("");
  const [fType, setFType] = useState("all");
  const [fPrio, setFPrio] = useState("all");
  const [fAssignee, setFAssignee] = useState("all");

  const [searchParams] = useSearchParams();
  const wantProject = searchParams.get("project");

  useEffect(() => {
    fetchSprintProjects()
      .then((p) => { setProjects(p); const pre = wantProject && p.some((x) => x.id === wantProject) ? wantProject : p[0]?.id; if (pre) setSel(pre); })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoadingP(false));
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!sel) return;
    setLoadingB(true); setBoard(null); setSprintIdx(0); setThumbs({});
    fetchSprintBoard(sel)
      .then(setBoard)
      .catch((e) => toast((e as Error).message))
      .finally(() => setLoadingB(false));
  }, [sel]);

  const selProject = projects.find((p) => p.id === sel);
  const sprint = board?.sprints[sprintIdx];
  const columns = board?.columns ?? [];

  // lazily pull attachment thumbnails for the visible sprint
  useEffect(() => {
    if (!sel || !sprint) return;
    const hasDocs = sprint.items.some((i) => i.hasDocs);
    if (!hasDocs) return;
    fetchThumbs(sel, sprint.id).then(setThumbs).catch(() => {});
  }, [sel, sprint]);

  const types = useMemo(() => Array.from(new Set((sprint?.items ?? []).map((i) => i.type).filter(Boolean))) as string[], [sprint]);
  const assignees = useMemo(
    () => Array.from(new Set((sprint?.items ?? []).flatMap((i) => i.assignees ?? []).filter(Boolean))).sort() as string[],
    [sprint]);

  const match = (it: ZohoItem) =>
    (fType === "all" || it.type === fType) &&
    (fPrio === "all" || it.priority === fPrio) &&
    (fAssignee === "all" || (it.assignees ?? []).includes(fAssignee)) &&
    (!query || `${it.ticketNumber} ${it.subject}`.toLowerCase().includes(query.toLowerCase()));

  // group current sprint's items by statusId into columns (after filter)
  const grouped = useMemo(() => {
    const map: Record<string, ZohoItem[]> = {};
    for (const c of columns) map[c.id] = [];
    const extra: ZohoItem[] = [];
    for (const it of (sprint?.items ?? []).filter(match)) {
      if (it.statusId && map[it.statusId]) map[it.statusId].push(it);
      else extra.push(it);
    }
    return { map, extra };
  }, [sprint, columns, query, fType, fPrio, fAssignee]);

  if (zoho.status === "disconnected") return (
    <main className="page">
      <div className="h1">Sprints</div>
      <SetupRequired icon="sprint" title="Connect Zoho Sprints" sub="Add your Zoho keys in Settings to see your projects, sprints, and boards here." />
    </main>
  );

  return (
    <main className="page split-shell" style={{ padding: 0, overflow: "hidden" }}>
      {/* projects list */}
      <div className="split-side" style={{ width: 288, borderRight: "1px solid var(--border)", overflowY: "auto", padding: "24px 16px", flexShrink: 0 }}>
        <div className="rowhead"><div className="h2">Sprints</div>
          <span className="badge" style={{ color: "var(--muted)", background: "var(--raised)", border: "1px solid var(--border)" }}>{projects.length}</span></div>
        <div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 6 }}>Your Zoho Sprints projects</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 16 }}>
          {loadingP && <OrbitLoader label="Loading projects…" size={22} />}
          {err && !loadingP && <Empty icon="plug" title="Couldn't load projects" sub={err} mini />}
          {projects.map((p) => (
            <button key={p.id} onClick={() => setSel(p.id)} className="trow" style={p.id === sel ? { background: "var(--raised)", borderColor: "var(--border)" } : {}}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: p.id === sel ? "var(--mint)" : "var(--dim)" }}><Icon name="sprint" size={15} /></span>
                <span style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: 13.5 }}>{p.name}</span>
                {p.key && <span className="mono" style={{ fontSize: 10.5, color: "var(--dim)", marginLeft: "auto" }}>{p.key}</span>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* board */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", padding: "24px 26px 0" }}>
        {selProject && (
          <div>
            <div className="h1">{selProject.name}</div>
            <div className="sub">{board ? `${board.sprints.length} sprints · ${board.sprints.reduce((a, s) => a + s.items.length, 0)} work items` : "Loading…"}</div>
          </div>
        )}
        {loadingB && <div className="page-loader"><OrbitLoader label="Loading board…" /></div>}

        {!loadingB && board && (
          <>
            <div className="sprint-tabs">
              {board.sprints.map((s, i) => (
                <button key={s.id} className={"sprint-tab" + (i === sprintIdx ? " on" : "")} onClick={() => setSprintIdx(i)}>
                  <Icon name="sprint" size={13} />{s.name}<span style={{ opacity: .6 }}>{s.items.length}</span>
                </button>
              ))}
            </div>

            <div className="board-filter">
              <div className="bf-search"><Icon name="search" size={13} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by ticket ID or title…" /></div>
              <select className="bf-sel" value={fType} onChange={(e) => setFType(e.target.value)}>
                <option value="all">All types</option>
                {types.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className="bf-sel" value={fPrio} onChange={(e) => setFPrio(e.target.value)}>
                <option value="all">All priority</option>
                <option value="high">High</option><option value="med">Medium</option><option value="low">Low</option>
              </select>
              <select className="bf-sel" value={fAssignee} onChange={(e) => setFAssignee(e.target.value)} title="Filter by assignee">
                <option value="all">All assignees</option>
                {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              {(query || fType !== "all" || fPrio !== "all" || fAssignee !== "all") && <button className="bf-clear" onClick={() => { setQuery(""); setFType("all"); setFPrio("all"); setFAssignee("all"); }}>Clear</button>}
            </div>

            {sprint && (
              <div className="zboard">
                {columns.map((c) => {
                  const items = grouped.map[c.id] ?? [];
                  return (
                    <div key={c.id} className="zcol">
                      <div className="zcolhead">
                        <span className="zcoldot" style={{ background: c.color }} />
                        <span className="zcolname">{c.name}</span>
                        <span className="cnt">{items.length}</span>
                      </div>
                      <div className="zcards">
                        {items.map((it) => <Card key={it.id} it={it} thumb={thumbs[it.id]} onClick={() => setOpen({ sprintId: sprint.id, itemId: it.id })} />)}
                        {items.length === 0 && <div className="zempty">No items</div>}
                      </div>
                    </div>
                  );
                })}
                {grouped.extra.length > 0 && (
                  <div className="zcol">
                    <div className="zcolhead"><span className="zcoldot" style={{ background: ACCENT.dim }} /><span className="zcolname">Other</span><span className="cnt">{grouped.extra.length}</span></div>
                    <div className="zcards">{grouped.extra.map((it) => <Card key={it.id} it={it} thumb={thumbs[it.id]} onClick={() => setOpen({ sprintId: sprint.id, itemId: it.id })} />)}</div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {!loadingB && board && board.sprints.length === 0 && <Empty icon="sprint" title="No sprints" sub="This project has no sprints in scope." />}
      </div>

      {open && sel && <ItemModal projectId={sel} sprintId={open.sprintId} itemId={open.itemId} onClose={() => setOpen(null)} />}
    </main>
  );
}

function Card({ it, thumb, onClick }: { it: ZohoItem; thumb?: Thumb; onClick: () => void }) {
  const ty = typeStyle(it.type || "");
  const attachCount = thumb?.count ?? (it.hasDocs ? 1 : 0);
  return (
    <div className="zcard" style={{ borderLeftColor: ty.color }} onClick={onClick}>
      <div className="zt">
        <span className="ztype" style={{ color: ty.color, background: ty.color + "18" }}><Icon name={ty.icon} size={11} />{it.type || "Item"}</span>
        <span className="znum mono" style={{ marginLeft: "auto" }} title="Ticket ID">{it.ticketNumber || `#${it.id}`}</span>
      </div>
      <div className="zsub">{it.subject}</div>
      <div className="zfoot">
        <span className="prdot" style={{ background: prColor(it.priority) }} title={`${it.priority} priority`} />
        {attachCount > 0 && <span className="zattach" title={`${attachCount} attachment${attachCount === 1 ? "" : "s"}`}><Icon name="link" size={11} />{attachCount}</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 3 }}>
          {(it.assignees ?? []).slice(0, 3).map((a, i) => <span key={i} className="zava" title={a}>{initials(a)}</span>)}
        </span>
      </div>
    </div>
  );
}

function ItemModal({ projectId, sprintId, itemId, onClose }: { projectId: string; sprintId: string; itemId: string; onClose: () => void }) {
  const [data, setData] = useState<ItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  const [lbLoaded, setLbLoaded] = useState(false);
  const [lbError, setLbError] = useState(false);
  useEffect(() => { if (lightbox) { setLbLoaded(false); setLbError(false); } }, [lightbox]);
  useEffect(() => {
    fetchItemDetail(projectId, sprintId, itemId).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [projectId, sprintId, itemId]);
  const it = data?.item;
  const ty = typeStyle(it?.type || "");

  return (
    <div className="modal-bg">
      <div className="modal item-modal">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            {it && <span className="im-tag" style={{ color: ty.color, background: ty.color + "18" }}><Icon name={ty.icon} size={12} />{it.type || "Item"}</span>}
            <h3 style={{ marginTop: 10, lineHeight: 1.3 }}>{loading ? "Loading…" : it?.subject ?? "Item"}</h3>
            {it && <div className="mono" style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 4 }}>{it.ticketNumber}</div>}
          </div>
          <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        {loading && <OrbitLoader label="Loading details…" />}

        {!loading && it && (
          <>
            <div className="im-grid">
              <span className="k">Status</span><span>{it.status}</span>
              <span className="k">Priority</span><span style={{ textTransform: "capitalize" }}>{it.priority}</span>
              <span className="k">Type</span><span>{it.type || "—"}</span>
              {(it.assignees?.length ?? 0) > 0 && <><span className="k">Assignees</span><span>{it.assignees!.join(", ")}</span></>}
              {it.points && <><span className="k">Points</span><span>{it.points}</span></>}
              {it.endDate && it.endDate !== "-1" && <><span className="k">Due</span><span>{it.endDate.slice(0, 10)}</span></>}
            </div>

            <div className="im-sec">
              <div className="eyebrow">Description</div>
              <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 13.3, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                {it.description ? stripHtml(it.description) : "No description on this item."}
              </div>
            </div>

            <div className="im-sec">
              <div className="eyebrow">Attachments{(data?.attachments?.length ?? 0) > 0 ? ` · ${data!.attachments.length}` : ""}</div>
              {(data?.attachments?.length ?? 0) === 0 && <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--dim)" }}>{it.hasDocs ? "This item has attachments in Zoho Sprints." : "No attachments."}</div>}
              {data?.attachments?.map((a, i) => {
                const renderable = isImage(a) || isVideo(a);
                return (
                  <div key={i} className="im-att">
                    <span style={{ color: renderable ? ACCENT.violet : ACCENT.blue }}><Icon name={renderable ? "grid" : "link"} size={14} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                      <div style={{ fontSize: 10.5, color: "var(--dim)", marginTop: 2 }} className="mono">
                        {a.ext ? a.ext.toUpperCase() + " · " : ""}{a.size ? fmtSize(a.size) : ""}{a.owner ? " · " + a.owner : ""}
                      </div>
                    </div>
                    {renderable
                      ? <button className="btn ghost sm" onClick={() => setLightbox(a)}><Icon name="search" size={13} />View</button>
                      : a.downloadUrl && <a className="btn ghost sm" href={a.downloadUrl} target="_blank" rel="noreferrer"><Icon name="ext" size={13} />Open in Zoho</a>}
                  </div>
                );
              })}
            </div>
          </>
        )}
        {!loading && !it && <div style={{ color: "var(--dim)", padding: "20px 0" }}>Couldn't load this item.</div>}
      </div>
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <button className="lb-close" onClick={() => setLightbox(null)}><Icon name="x" size={18} /></button>
          {!lbLoaded && !lbError && <div className="lb-loading"><OrbitLoader label="Loading preview…" size={40} /></div>}
          {lbError ? (
            <div className="lb-fallback" onClick={(e) => e.stopPropagation()}>
              <Icon name="plug" size={28} />
              <p>Preview unavailable — Zoho requires you to be signed in to view this file.</p>
              {lightbox.downloadUrl && <a className="btn accent" href={lightbox.downloadUrl} target="_blank" rel="noreferrer"><Icon name="ext" size={14} />Open in Zoho</a>}
            </div>
          ) : isVideo(lightbox) ? (
            <video src={lightbox.downloadUrl || lightbox.large} className={lbLoaded ? "" : "loading"} controls autoPlay
              onLoadedData={() => setLbLoaded(true)} onError={() => setLbError(true)} onClick={(e) => e.stopPropagation()} />
          ) : (
            <img src={lightbox.large || lightbox.thumb} alt={lightbox.name} className={lbLoaded ? "" : "loading"}
              onLoad={() => setLbLoaded(true)} onError={() => setLbError(true)} onClick={(e) => e.stopPropagation()} />
          )}
          {!lbError && <div className="lb-cap" onClick={(e) => e.stopPropagation()}>{lightbox.name}</div>}
        </div>
      )}
    </div>
  );
}
