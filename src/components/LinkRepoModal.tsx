import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "./Modal";
import { Icon } from "../lib/icons";
import { fetchProviderConnections } from "../lib/providerConnections";
import { fetchGithubRepos } from "../lib/github";
import { fetchGitlabRepos } from "../lib/gitlab";
import { fetchAzureDevopsRepos } from "../lib/azureDevops";

interface RepoOption { id: string; fullName: string; defaultBranch: string; }
type LinkableProvider = "github" | "gitlab" | "azuredevops";

export interface RepoLinkPatch {
  repo_provider: LinkableProvider; repo_full_name: string; repo_id: string; repo_default_branch: string;
}

/** Repo picker for the "link a repository" flow — its own modal rather than
 * folded into EditProjectModal, since it does live async data-fetching that
 * EditProjectModal otherwise never needs. */
export function LinkRepoModal({ onClose, onSave }: { onClose: () => void; onSave: (patch: RepoLinkPatch) => void }) {
  const nav = useNavigate();
  const [available, setAvailable] = useState<LinkableProvider[]>([]);
  const [checked, setChecked] = useState(false);
  const [provider, setProvider] = useState<LinkableProvider | null>(null);
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProviderConnections().then((conns) => {
      const ids = conns
        .filter((c) => c.status === "connected" && (c.provider === "github" || c.provider === "gitlab" || c.provider === "azuredevops"))
        .map((c) => c.provider as LinkableProvider);
      setAvailable(ids);
      if (ids.length >= 1) setProvider(ids[0]);
      setChecked(true);
    });
  }, []);

  useEffect(() => {
    if (!provider) return;
    setLoading(true); setError(null);
    const load = provider === "github" ? fetchGithubRepos() : provider === "gitlab" ? fetchGitlabRepos() : fetchAzureDevopsRepos();
    load.then((r) => setRepos(r)).catch((e) => setError((e as Error).message)).finally(() => setLoading(false));
  }, [provider]);

  const filtered = repos.filter((r) => r.fullName.toLowerCase().includes(query.toLowerCase()));

  return (
    <Modal onClose={onClose} style={{ width: 480, maxWidth: "94vw" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>Link a repository</h3>
        <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>

      {checked && available.length === 0 ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, color: "var(--dim)" }}>No GitHub, GitLab or Azure DevOps connection yet — connect one in Settings first.</div>
          <button className="btn accent" style={{ marginTop: 12 }} onClick={() => { onClose(); nav("/settings?section=github"); }}>
            <Icon name="github" size={14} />Go to Settings
          </button>
        </div>
      ) : (
        <>
          {available.length > 1 && (
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              {available.map((id) => (
                <button key={id} className={"btn" + (provider === id ? " accent" : "")} onClick={() => setProvider(id)}>
                  <Icon name={id} size={14} />{id === "github" ? "GitHub" : id === "gitlab" ? "GitLab" : "Azure DevOps"}
                </button>
              ))}
            </div>
          )}
          <div className="fld" style={{ marginTop: 12 }}>
            <label>Search repositories</label>
            <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="org/repo" autoFocus />
          </div>
          {error && <div style={{ marginTop: 8, fontSize: 12, color: "var(--amber)" }}>{error}</div>}
          <div style={{ marginTop: 10, maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {loading ? (
              <div style={{ padding: 12, color: "var(--dim)", fontSize: 13 }}>Loading repositories…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 12, color: "var(--dim)", fontSize: 13 }}>No matches.</div>
            ) : filtered.slice(0, 50).map((r) => (
              <button key={r.id} className="btn ghost" style={{ justifyContent: "flex-start", textAlign: "left" }}
                onClick={() => provider && onSave({ repo_provider: provider, repo_full_name: r.fullName, repo_id: r.id, repo_default_branch: r.defaultBranch })}>
                <Icon name="git" size={14} />{r.fullName}
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
