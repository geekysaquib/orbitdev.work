/**
 * Settings → Local agent → VS Code.
 *
 * Three things the user needs in one place: proof the `code` CLI is reachable,
 * the session token to paste into the extension, and whether the extension is
 * actually reporting (the live editor state is the only honest "it works").
 */
import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { useToast } from "../context/Toast";
import { useAgent } from "../context/Agent";
import { getToken } from "../lib/auth";
import {
  vscodeStatus, fetchEditorState, listVscodeExtensions,
  orbitExtensionPackage, installOrbitExtension,
  type VscodeStatus, type EditorState,
} from "../lib/vscode";

const fileName = (p?: string | null) => (p ? p.split(/[\\/]/).pop() || p : null);

export function VscodePanel() {
  const toast = useToast();
  const { status: agentStatus } = useAgent();
  const online = agentStatus === "online";
  const [code, setCode] = useState<VscodeStatus | null>(null);
  const [editor, setEditor] = useState<EditorState>({ connected: false });
  const [extCount, setExtCount] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [pkg, setPkg] = useState<{ available: boolean; version?: string } | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!online) { setCode(null); setEditor({ connected: false }); setExtCount(null); return; }
    let stopped = false;
    const load = async () => {
      const [s, e] = await Promise.all([vscodeStatus(), fetchEditorState()]);
      if (stopped) return;
      setCode(s); setEditor(e);
    };
    void load();
    listVscodeExtensions().then((x) => { if (!stopped) setExtCount(x.length); }).catch(() => {});
    orbitExtensionPackage().then((p) => { if (!stopped) setPkg(p); }).catch(() => {});
    // The extension heartbeats every 15s — poll a little slower than that so the
    // "connected" dot reflects reality without hammering the agent.
    const t = setInterval(load, 20_000);
    return () => { stopped = true; clearInterval(t); };
  }, [online]);

  async function install() {
    setInstalling(true);
    const r = await installOrbitExtension();
    setInstalling(false);
    if (!r.ok) { toast(`Couldn't install: ${r.error}`); return; }
    // `code --install-extension` doesn't reload an already-running window, so the
    // command palette won't show ORBIT's commands until VS Code is reloaded.
    toast("Extension installed — reload VS Code (Ctrl+Shift+P → Developer: Reload Window)");
  }

  async function copyToken() {
    const t = getToken();
    if (!t) { toast("No active session — sign in again"); return; }
    try {
      await navigator.clipboard.writeText(t);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast("Token copied — paste it into VS Code via “ORBIT: Sign in”");
    } catch { toast("Couldn't copy — check clipboard permissions"); }
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="setrow">
        <div className="l">
          <div className="nm">VS Code</div>
          <div className="ds">
            Jump to code, open multi-root workspaces, and — with the ORBIT extension — track focus from what you're
            actually editing instead of browser-tab activity.
          </div>
        </div>
        {!online ? <span className="pill"><Icon name="plug" size={15} />Agent offline</span>
          : code?.available ? <span className="pill live"><Icon name="check" size={15} />code {code.version}<span className="dotled" /></span>
            : <span className="pill warn"><Icon name="plug" size={15} />CLI not found<span className="dotled warn" /></span>}
      </div>

      {online && code && !code.available && (
        <div className="setrow"><div className="l"><div className="ds">{code.error}</div></div></div>
      )}

      <div className="setrow">
        <div className="l">
          <div className="nm">ORBIT extension</div>
          <div className="ds">
            {editor.connected
              ? <>Reporting now{editor.language ? ` · ${editor.language}` : ""}{fileName(editor.file) ? ` · ${fileName(editor.file)}` : ""}{editor.project ? ` · ${editor.project}` : ""}</>
              : pkg?.available
                ? <>Not installed yet. Install it here, reload VS Code, then run <span className="mono">ORBIT: Sign in</span> and paste the token.</>
                : "Not reporting. Build the .vsix first: npm run package in the extension/ folder."}
          </div>
        </div>
        {editor.connected
          ? <span className="pill live"><Icon name="zap" size={15} />Connected<span className="dotled" /></span>
          : pkg?.available
            ? <button className="btn accent" disabled={installing || !code?.available} onClick={install}>
                {installing
                  ? <><Icon name="loader" size={15} className="spin" />Installing…</>
                  : <><Icon name="download" size={15} />Install extension{pkg.version ? ` v${pkg.version}` : ""}</>}
              </button>
            : null}
      </div>

      {/* The token is the second step either way — kept on its own row so it stays
          reachable after install, and after a sign-out invalidates the old one. */}
      <div className="setrow">
        <div className="l">
          <div className="ds">
            {editor.connected
              ? "Pasting a fresh token replaces the old one — useful after signing out."
              : "Step 2: copy your session token, then paste it into VS Code via “ORBIT: Sign in”."}
          </div>
        </div>
        <button className={editor.connected ? "btn ghost" : "btn"} onClick={copyToken}>
          <Icon name={copied ? "check" : "copy"} size={15} />{copied ? "Copied" : "Copy VS Code token"}
        </button>
      </div>

      {extCount !== null && (
        <div className="setrow">
          <div className="l"><div className="nm">Installed extensions</div><div className="ds">{extCount} extension{extCount === 1 ? "" : "s"} detected on this machine.</div></div>
        </div>
      )}
    </div>
  );
}
