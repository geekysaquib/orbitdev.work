import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { useToast } from "../context/Toast";
import { CHORES, DEFAULT_CHORES, cachedChores, loadChores, saveChores, type ChoreSettings, type ChoreId, type ChoreMeta } from "../lib/chores";

const GROUPS: ChoreMeta["group"][] = ["Git", "Dependencies", "Zoho", "Orbit", "Infra"];
const INTERVALS = [30, 60, 120, 300];

export function ChoresCard() {
  const toast = useToast();
  const [cfg, setCfg] = useState<ChoreSettings>(() => cachedChores());
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadChores().then(setCfg); }, []);

  const persist = async (next: ChoreSettings) => {
    setCfg(next);
    setSaving(true);
    await saveChores(next);
    setSaving(false);
  };
  const toggle = (id: ChoreId) => persist({ ...cfg, enabled: { ...cfg.enabled, [id]: !cfg.enabled[id] } });
  const enabledCount = CHORES.filter((c) => cfg.enabled[c.id]).length;

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div className="ch-sub" style={{ marginTop: 0 }}>
          Chores run only while you're on a break and the agent is online. {enabledCount} of {CHORES.length} enabled.
        </div>
        <button className="btn ghost" onClick={() => persist(DEFAULT_CHORES)} disabled={saving}>Reset</button>
      </div>

      <div className="ch-row" style={{ marginTop: 18 }}>
        <div>
          <div className="ch-name">Re-run every</div>
          <div className="ch-desc">How often the whole cycle repeats. The agent also pushes changes instantly.</div>
        </div>
        <div className="ch-ints">
          {INTERVALS.map((s) => (
            <button key={s} className={"ch-int" + (cfg.intervalSec === s ? " on" : "")} onClick={() => persist({ ...cfg, intervalSec: s })}>
              {s < 60 ? `${s}s` : `${s / 60}m`}
            </button>
          ))}
        </div>
      </div>

      <div className="ch-row">
        <div>
          <div className="ch-name">Escalate warnings to notifications</div>
          <div className="ch-desc">A merge conflict found at 11am shouldn't vanish when the break ends.</div>
        </div>
        <Switch on={cfg.notifyWarnings} onClick={() => persist({ ...cfg, notifyWarnings: !cfg.notifyWarnings })} />
      </div>

      <div className="ch-row danger">
        <div>
          <div className="ch-name">Allow Docker prune <span className="ch-tag">writes</span></div>
          <div className="ch-desc">Runs <code>docker system prune -f</code> when dangling images are found. Off by default.</div>
        </div>
        <Switch on={cfg.allowDockerPrune} onClick={() => persist({ ...cfg, allowDockerPrune: !cfg.allowDockerPrune })} danger />
      </div>

      {GROUPS.map((g) => {
        const items = CHORES.filter((c) => c.group === g);
        if (!items.length) return null;
        return (
          <div key={g} style={{ marginTop: 18 }}>
            <div className="ch-group">{g}</div>
            {items.map((c) => (
              <div key={c.id} className="ch-row">
                <div>
                  <div className="ch-name">
                    {c.label}
                    {c.slow && <span className="ch-tag slow">slow</span>}
                    {c.writes && <span className="ch-tag">writes</span>}
                  </div>
                  <div className="ch-desc">{c.desc}</div>
                </div>
                <Switch on={!!cfg.enabled[c.id]} onClick={() => toggle(c.id)} />
              </div>
            ))}
          </div>
        );
      })}

      <div className="ch-foot">
        <Icon name="shield" size={13} />
        Every chore is read-only unless tagged <b>writes</b>. Nothing runs unless you're on a break and the agent is online.
        {saving && <span style={{ marginLeft: "auto", color: "var(--mint)" }}>Saving…</span>}
      </div>
    </div>
  );
}

function Switch({ on, onClick, danger }: { on: boolean; onClick: () => void; danger?: boolean }) {
  return (
    <button className={"ch-sw" + (on ? " on" : "") + (danger ? " danger" : "")} onClick={onClick} role="switch" aria-checked={on}>
      <span />
    </button>
  );
}
