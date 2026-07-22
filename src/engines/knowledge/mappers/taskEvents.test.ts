import { describe, it, expect } from "vitest";
import { taskEventMapper } from "./taskEvents";

function event(type: string, payload: Record<string, unknown>) {
  return { id: "1", source: "task-workflow", type, occurredAt: "2026-01-01T00:00:00.000Z", payload };
}

describe("taskEventMapper", () => {
  it("upserts a task entity + belongs_to relationship on created", () => {
    const r = taskEventMapper(event("created", { taskId: "t1", projectId: "p1", title: "Fix bug", status: "todo", priority: "high" }));
    expect(r?.entity).toEqual({
      ref: { type: "task", id: "t1" }, label: "Fix bug",
      attributes: { status: "todo", priority: "high", dueDate: null, completedAt: null },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(r?.relationships).toEqual([{ from: { type: "task", id: "t1" }, type: "belongs_to", to: { type: "project", id: "p1" } }]);
  });

  it("carries every graph-relevant field on status_changed, not just what changed", () => {
    const r = taskEventMapper(event("status_changed", {
      taskId: "t1", projectId: "p1", status: "done", previousStatus: "doing", title: "Fix bug", priority: "high", dueDate: "2026-02-01", completedAt: "2026-01-01T00:00:00.000Z",
    }));
    expect(r?.entity?.attributes).toEqual({ status: "done", priority: "high", dueDate: "2026-02-01", completedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("omits the relationship when the task has no project", () => {
    const r = taskEventMapper(event("created", { taskId: "t1", title: "Standalone", status: "todo" }));
    expect(r?.relationships).toEqual([]);
  });

  it("returns a deleteRef on deleted, no entity upsert", () => {
    const r = taskEventMapper(event("deleted", { taskId: "t1", title: "Fix bug" }));
    expect(r).toEqual({ deleteRef: { type: "task", id: "t1" } });
  });

  it("ignores shared — team sharing isn't modeled in task attributes", () => {
    expect(taskEventMapper(event("shared", { taskId: "t1", previousTeamId: null, teamId: "team1" }))).toBeNull();
  });

  it("ignores events from other sources or missing taskId", () => {
    expect(taskEventMapper(event("created", { title: "x" }))).toBeNull(); // no taskId
    expect(taskEventMapper({ id: "1", source: "project-workflow", type: "created", occurredAt: "t", payload: { taskId: "t1" } })).toBeNull();
  });
});
