import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Eyebrow, Empty } from "./ui";
import type { Project } from "../lib/types";

/**
 * Sits beside a repo-provider setup panel (GitHub/GitLab/Azure DevOps) in
 * Settings — fills the space next to the connect form with something
 * actually relevant to that provider instead of empty page.
 */
export function LinkedProjectsPanel({ provider, label, projects }: {
  provider: NonNullable<Project["repo_provider"]>; label: string; projects: Project[];
}) {
  const nav = useNavigate();
  const linked = projects.filter((p) => p.repo_provider === provider);

  return (
    <div className="card" style={{ padding: 20, flex: "1 1 260px" }}>
      <Eyebrow>Linked projects</Eyebrow>
      {linked.length === 0 ? (
        <div style={{ marginTop: 10 }}>
          <Empty icon="git" title="Nothing linked yet" sub={`Link a project to ${label} from its Git tab.`} mini />
        </div>
      ) : (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {linked.map((p) => (
            <button key={p.id} className="btn ghost" style={{ width: "100%", justifyContent: "flex-start", textAlign: "left" }} onClick={() => nav(`/projects/${p.id}`)}>
              <Icon name="boxes" size={14} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
