import { describe, it, expect } from "vitest";
import { projectEventMapper } from "./projectEvents";

function event(type: string, payload: Record<string, unknown>) {
  return { id: "1", source: "project-workflow", type, occurredAt: "2026-01-01T00:00:00.000Z", payload };
}

describe("projectEventMapper", () => {
  it("upserts a project entity on created", () => {
    const r = projectEventMapper(event("created", { projectId: "p1", name: "Orbit", status: "active", client: "Acme" }));
    expect(r?.entity).toEqual({
      ref: { type: "project", id: "p1" }, label: "Orbit",
      attributes: { status: "active", client: "Acme", repoProvider: null, repoFullName: null, repoDefaultBranch: null },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("carries every graph-relevant field on repo_linked, not just repo fields", () => {
    const r = projectEventMapper(event("repo_linked", { projectId: "p1", status: "active", client: "Acme", repoProvider: "github", repoFullName: "org/orbit", repoDefaultBranch: "main" }));
    expect(r?.entity?.attributes).toEqual({ status: "active", client: "Acme", repoProvider: "github", repoFullName: "org/orbit", repoDefaultBranch: "main" });
  });

  it("clears repo fields on repo_unlinked while preserving status/client", () => {
    const r = projectEventMapper(event("repo_unlinked", { projectId: "p1", status: "active", client: "Acme" }));
    expect(r?.entity?.attributes).toEqual({ status: "active", client: "Acme", repoProvider: null, repoFullName: null, repoDefaultBranch: null });
  });

  it("returns a deleteRef on deleted", () => {
    expect(projectEventMapper(event("deleted", { projectId: "p1", name: "Orbit" }))).toEqual({ deleteRef: { type: "project", id: "p1" } });
  });

  it("ignores shared and sprint_linked/unlinked — neither is modeled in project attributes", () => {
    expect(projectEventMapper(event("shared", { projectId: "p1", teamId: "t1" }))).toBeNull();
    expect(projectEventMapper(event("sprint_linked", { projectId: "p1", sprintProjectId: "sp1" }))).toBeNull();
    expect(projectEventMapper(event("sprint_unlinked", { projectId: "p1" }))).toBeNull();
  });

  it("ignores events from other sources or missing projectId", () => {
    expect(projectEventMapper(event("created", { name: "x" }))).toBeNull();
    expect(projectEventMapper({ id: "1", source: "task-workflow", type: "created", occurredAt: "t", payload: { projectId: "p1" } })).toBeNull();
  });
});
