/**
 * Webview markup for the ORBIT sidebar.
 *
 * Rendered as a string rather than pulled from a file so the whole extension
 * stays a single bundled module. All colour comes from VS Code's own theme
 * variables, so the panel matches whatever theme the user runs — hardcoding
 * ORBIT's palette here would look wrong in a light theme.
 *
 * The webview owns only presentation and the ticking clock; every state change
 * is a postMessage to the extension host, which relays it to ORBIT.
 */
export function panelHtml(nonce: string, csp: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style nonce="${nonce}">
  :root { --gap: 10px; --radius: 6px; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: var(--gap);
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); background: transparent;
  }
  button { font-family: inherit; cursor: pointer; border: none; border-radius: 4px; }
  .btn {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    padding: 5px 10px; font-size: 12px; display: inline-flex; align-items: center; gap: 5px;
  }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
  .btn.sec { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn.sec:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .icon-btn {
    background: transparent; color: var(--vscode-descriptionForeground);
    padding: 2px 5px; font-size: 12px; line-height: 1;
  }
  .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }

  .card {
    background: var(--vscode-editorWidget-background, rgba(127,127,127,.08));
    border: 1px solid var(--vscode-editorWidget-border, transparent);
    border-radius: var(--radius); padding: 10px; margin-bottom: var(--gap);
  }

  /* ---- timer ---- */
  .clock { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: .5px; line-height: 1.1; }
  .clock.idle { color: var(--vscode-descriptionForeground); }
  .timer-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .timer-meta { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 3px; }
  .hours { display: flex; gap: 14px; margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--vscode-editorWidget-border, rgba(127,127,127,.2)); }
  .stat-l { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--vscode-descriptionForeground); }
  .stat-v { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }

  /* ---- now editing ---- */
  .editing { display: flex; align-items: center; gap: 7px; font-size: 11.5px; color: var(--vscode-descriptionForeground); }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-charts-green, #3fb950); flex: none; }
  .dot.off { background: var(--vscode-descriptionForeground); opacity: .5; }
  .ellip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ---- sections ---- */
  .sec-head {
    display: flex; align-items: center; gap: 6px; margin: 14px 0 6px;
    font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
    color: var(--vscode-descriptionForeground);
  }
  .sec-head .count { opacity: .7; }
  .sec-head .spacer { flex: 1; }

  input[type=text] {
    width: 100%; padding: 5px 8px; font-family: inherit; font-size: 12px;
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; outline: none;
  }
  input[type=text]:focus { border-color: var(--vscode-focusBorder); }

  /* ---- items ---- */
  .grp { font-size: 10.5px; color: var(--vscode-descriptionForeground); margin: 8px 0 4px; text-transform: uppercase; letter-spacing: .05em; }
  .item {
    display: flex; align-items: flex-start; gap: 7px; padding: 5px 6px;
    border-radius: 4px; border-left: 2px solid transparent;
  }
  .item:hover { background: var(--vscode-list-hoverBackground); }
  .item:hover .row-actions { opacity: 1; }
  .item.p-high { border-left-color: var(--vscode-charts-red, #f85149); }
  .item.p-med  { border-left-color: var(--vscode-charts-yellow, #d29922); }
  .item.p-low  { border-left-color: var(--vscode-charts-blue, #58a6ff); }
  .item.active { background: var(--vscode-list-activeSelectionBackground); }
  .item-main { flex: 1; min-width: 0; }
  .item-title { font-size: 12.5px; line-height: 1.35; cursor: pointer; }
  .item-sub { font-size: 10.5px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .row-actions { display: flex; gap: 1px; opacity: 0; transition: opacity .1s; flex: none; }

  .empty { font-size: 11.5px; color: var(--vscode-descriptionForeground); padding: 6px 2px; }

  /* ---- brand header + connectivity ---- */
  .brand { display: flex; align-items: center; gap: 8px; margin-bottom: var(--gap); }
  .brand svg { flex: none; color: var(--vscode-charts-green, #3fb950); }
  .brand-name { font-size: 12.5px; font-weight: 600; letter-spacing: .06em; }
  .conn { display: flex; align-items: center; gap: 9px; margin-left: auto; }
  .conn span { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--vscode-descriptionForeground); }
  .led { width: 6px; height: 6px; border-radius: 50%; }
  .led.on { background: var(--vscode-charts-green, #3fb950); }
  .led.off { background: var(--vscode-charts-red, #f85149); }
  .led.warn { background: var(--vscode-charts-yellow, #d29922); }

  /* ---- break ---- */
  .break {
    display: flex; align-items: center; gap: 9px; padding: 10px;
    border-radius: var(--radius); margin-bottom: var(--gap);
    background: var(--vscode-inputValidation-infoBackground, rgba(88,166,255,.12));
    border: 1px solid var(--vscode-inputValidation-infoBorder, rgba(88,166,255,.4));
  }
  .break .cup { font-size: 17px; }
  .break-t { font-size: 12px; font-weight: 600; }
  .break-s { font-size: 10.5px; color: var(--vscode-descriptionForeground); margin-top: 2px; }

  /* ---- AI ---- */
  .ai-badge {
    font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
    padding: 1px 5px; border-radius: 3px; flex: none;
    background: var(--vscode-charts-purple, #a371f7); color: var(--vscode-editor-background, #000);
  }
  .ai-badge.n { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .ai-why { font-size: 10.5px; color: var(--vscode-charts-purple, #a371f7); margin-top: 2px; font-style: italic; }
  .title-row { display: flex; align-items: center; gap: 6px; }
  .warn {
    font-size: 11px; padding: 6px 8px; border-radius: 4px; margin-bottom: var(--gap);
    background: var(--vscode-inputValidation-warningBackground, rgba(210,153,34,.15));
    border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(210,153,34,.4));
  }
  .center { text-align: center; padding: 22px 10px; }
  .center p { font-size: 12px; color: var(--vscode-descriptionForeground); margin: 0 0 12px; line-height: 1.5; }
  .hidden { display: none !important; }
</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let state = {
  signedIn: false, agent: false, orbitOpen: false, fresh: true,
  tasks: [], tickets: [], timer: { running: false }, hours: null,
  editor: {}, break: {}, ai: null, aiBusy: false, filter: "",
};
let tick = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const send = (type, payload) => vscode.postMessage({ type, payload });

function agoText(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  return m < 1 ? "just now" : m < 60 ? m + "m ago" : Math.floor(m / 60) + "h ago";
}

function hhmmss(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const p = (n) => String(n).padStart(2, "0");
  return p(Math.floor(s / 3600)) + ":" + p(Math.floor((s % 3600) / 60)) + ":" + p(s % 60);
}

/** Seconds shown must keep counting between the host's 45s pushes. */
function liveSeconds() {
  const t = state.timer || {};
  if (!t.running) return 0;
  return t.startedAt ? (Date.now() - t.startedAt) / 1000 : (t.seconds || 0);
}

const TASK_ORDER = ["doing", "review", "todo"];
const TASK_LABEL = { doing: "In progress", review: "In review", todo: "To do", done: "Done" };
const NEXT_STATUS = { todo: "doing", doing: "review", review: "done", done: "todo" };

/** AI rank for a task id, or null when it wasn't ranked (or ranking never ran). */
function aiFor(id) {
  const items = (state.ai && state.ai.items) || [];
  const i = items.findIndex((x) => x.id === id);
  return i < 0 ? null : { pos: i + 1, reason: items[i].reason };
}

function itemHtml(w, kind) {
  const pr = (w.priority || "").toLowerCase();
  const sub = [w.project, kind === "ticket" ? w.status : null].filter(Boolean).join(" · ");
  const isTimed = state.timer.running && state.timer.taskId === w.id;
  const ai = kind === "task" ? aiFor(w.id) : null;
  const badge = ai
    ? \`<span class="ai-badge \${ai.pos === 1 ? "" : "n"}" title="AI focus rank">\${ai.pos === 1 ? "Focus now" : "#" + ai.pos}</span>\`
    : "";
  return \`<div class="item p-\${esc(pr)} \${isTimed ? "active" : ""}">
    <div class="item-main">
      <div class="title-row">
        \${badge}
        <div class="item-title ellip" title="\${esc(w.title)}" data-open="\${esc(w.id)}" data-kind="\${kind}">\${esc(w.title)}</div>
      </div>
      \${ai && ai.reason ? \`<div class="ai-why ellip" title="\${esc(ai.reason)}">\${esc(ai.reason)}</div>\` : ""}
      \${sub ? \`<div class="item-sub ellip">\${esc(sub)}</div>\` : ""}
    </div>
    <div class="row-actions">
      \${kind === "task" ? \`<button class="icon-btn" title="\${isTimed ? "Stop timer" : "Start timer on this task"}" data-timer="\${esc(w.id)}">\${isTimed ? "■" : "▶"}</button>
      <button class="icon-btn" title="Move to \${esc(TASK_LABEL[NEXT_STATUS[w.status]] || "next")}" data-next="\${esc(w.id)}" data-status="\${esc(NEXT_STATUS[w.status] || "doing")}">✓</button>\` : ""}
      <button class="icon-btn" title="Open in ORBIT" data-open="\${esc(w.id)}" data-kind="\${kind}">↗</button>
    </div>
  </div>\`;
}

const LOGO = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3.2"/><ellipse cx="12" cy="12" rx="10" ry="4.6" transform="rotate(-28 12 12)"/></svg>';

/** Agent reachable / ORBIT tab open — the two things that decide whether anything here works. */
function headerHtml() {
  const agentCls = state.agent ? "on" : "off";
  const orbitCls = state.orbitOpen ? "on" : state.agent ? "warn" : "off";
  return \`<div class="brand">
    \${LOGO}<span class="brand-name">ORBIT</span>
    <span class="conn">
      <span title="Local agent \${state.agent ? "reachable" : "unreachable"}"><i class="led \${agentCls}"></i>Agent</span>
      <span title="\${state.orbitOpen ? "An ORBIT tab is open — actions apply instantly" : "No ORBIT tab open — actions can't be applied"}"><i class="led \${orbitCls}"></i>App</span>
    </span>
  </div>\`;
}

function breakHtml() {
  const b = state.break || {};
  if (b.onBreak) {
    const mins = b.startedAt ? Math.max(0, Math.round((Date.now() - b.startedAt) / 60000)) : null;
    return \`<div class="break">
      <span class="cup">☕</span>
      <div><div class="break-t">You're on a break</div>
      <div class="break-s">\${mins !== null ? mins + "m so far · " : ""}Timer paused until you're refreshed</div></div>
    </div>\`;
  }
  if (b.idlePaused) {
    return \`<div class="break">
      <span class="cup">⏸</span>
      <div><div class="break-t">Timer paused — no activity</div>
      <div class="break-s">It resumes the moment you're back</div></div>
    </div>\`;
  }
  return "";
}

function render() {
  const root = document.getElementById("root");

  if (!state.agent) {
    root.innerHTML = headerHtml() + \`<div class="center"><p>ORBIT agent isn't reachable.<br/>Start it, then refresh.</p>
      <button class="btn" data-act="refresh">Retry</button></div>\`;
  } else if (!state.signedIn) {
    root.innerHTML = headerHtml() + \`<div class="center"><p>Sign in to see your ORBIT work here.<br/>Copy your token from ORBIT → Settings → Local agent.</p>
      <button class="btn" data-act="signin">Sign in</button></div>\`;
  } else {
    const t = state.timer || {};
    const secs = liveSeconds();
    const f = state.filter.toLowerCase();
    const match = (w) => !f || (w.title || "").toLowerCase().includes(f) || (w.project || "").toLowerCase().includes(f);
    const tasks = state.tasks.filter(match), tickets = state.tickets.filter(match);
    const ed = state.editor || {};

    // Within each status group, ranked tasks float to the top in AI order —
    // status still leads, so the list doesn't reshuffle into something unfamiliar.
    const byAi = (a, b) => {
      const ra = aiFor(a.id), rb = aiFor(b.id);
      if (ra && rb) return ra.pos - rb.pos;
      return ra ? -1 : rb ? 1 : 0;
    };
    const groups = TASK_ORDER.map((st) => {
      const rows = tasks.filter((x) => x.status === st).sort(byAi);
      if (!rows.length) return "";
      return \`<div class="grp">\${TASK_LABEL[st]} · \${rows.length}</div>\${rows.map((x) => itemHtml(x, "task")).join("")}\`;
    }).join("");

    root.innerHTML = headerHtml() + breakHtml() + \`
      \${state.fresh ? "" : \`<div class="warn">Showing the last synced data — open ORBIT to refresh.</div>\`}
      <div class="card">
        <div class="timer-row">
          <div>
            <div class="clock \${t.running ? "" : "idle"}" id="clock">\${hhmmss(secs)}</div>
            <div class="timer-meta">\${t.running ? esc(t.project || "No project") : "Timer stopped"}</div>
          </div>
          <button class="btn \${t.running ? "sec" : ""}" data-act="toggle">\${t.running ? "Stop" : "Start"}</button>
        </div>
        \${state.hours ? \`<div class="hours">
          <div><div class="stat-l">Today</div><div class="stat-v">\${esc(state.hours.today)}h</div></div>
          <div><div class="stat-l">All time</div><div class="stat-v">\${esc(state.hours.total)}h</div></div>
        </div>\` : ""}
      </div>

      <div class="card">
        <div class="editing">
          <span class="dot \${ed.connected ? "" : "off"}"></span>
          <span class="ellip">\${ed.connected
            ? esc([ed.file ? ed.file.split(/[\\\\/]/).pop() : null, ed.language, ed.project].filter(Boolean).join(" · ")) || "Editing"
            : "Not reporting activity"}</span>
        </div>
      </div>

      <input type="text" id="filter" placeholder="Filter tasks and tickets…" value="\${esc(state.filter)}" />

      <div class="sec-head"><span>Tasks</span><span class="count">\${tasks.length}</span><span class="spacer"></span>
        <button class="icon-btn" title="\${state.aiBusy ? "Ranking…" : "Rank tasks with AI"}" data-act="rank">\${state.aiBusy ? "◌" : "✨"}</button>
        <button class="icon-btn" title="New task" data-act="new">+</button>
        <button class="icon-btn" title="Refresh" data-act="refresh">⟳</button>
      </div>
      \${state.ai && state.ai.rankedAt ? \`<div class="item-sub" style="margin:0 0 4px 2px">AI focus order · \${esc(agoText(state.ai.rankedAt))}</div>\` : ""}
      \${groups || \`<div class="empty">\${state.tasks.length ? "No matches." : "Nothing open — nice."}</div>\`}

      <div class="sec-head"><span>Tickets</span><span class="count">\${tickets.length}</span></div>
      \${tickets.length ? tickets.map((x) => itemHtml(x, "ticket")).join("") : \`<div class="empty">\${state.tickets.length ? "No matches." : "No open tickets."}</div>\`}
    \`;
  }

  // Re-tick only while running, so an idle panel costs nothing.
  if (tick) { clearInterval(tick); tick = null; }
  if (state.timer && state.timer.running) {
    tick = setInterval(() => {
      const el = document.getElementById("clock");
      if (el) el.textContent = hhmmss(liveSeconds());
    }, 1000);
  }
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act],[data-open],[data-next],[data-timer]");
  if (!el) return;
  if (el.dataset.act === "toggle") return send("toggleTimer");
  if (el.dataset.act === "refresh") return send("refresh");
  if (el.dataset.act === "signin") return send("signIn");
  if (el.dataset.act === "new") return send("newTask");
  if (el.dataset.act === "rank") { state.aiBusy = true; render(); return send("rankTasks"); }
  if (el.dataset.timer) return send("timerForTask", { id: el.dataset.timer });
  if (el.dataset.next) return send("setStatus", { id: el.dataset.next, status: el.dataset.status });
  if (el.dataset.open) return send("open", { id: el.dataset.open, kind: el.dataset.kind });
});

// Keep focus and caret in the filter box across the re-render each keystroke causes.
document.addEventListener("input", (e) => {
  if (e.target.id !== "filter") return;
  state.filter = e.target.value;
  render();
  const box = document.getElementById("filter");
  if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
});

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg.type !== "state") return;
  // filter is webview-local; aiBusy clears only when a ranking actually lands.
  const ranked = msg.payload.ai && (!state.ai || msg.payload.ai.rankedAt !== state.ai.rankedAt);
  state = { ...state, ...msg.payload, filter: state.filter, aiBusy: state.aiBusy && !ranked };
  render();
});

render();
send("ready");
</script>
</body>
</html>`;
}
