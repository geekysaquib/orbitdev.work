import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Entity } from "../engines/knowledge";
import { myOpenTasks, myOverdueTasks, sortByUrgency } from "./myWork";

function task(id: string, attrs: Record<string, unknown>): Entity {
  return { ref: { type: "task", id }, label: id, attributes: attrs, updatedAt: "2026-01-01T00:00:00.000Z" };
}

const NOW = new Date(2026, 5, 15, 12, 0, 0);
const daysFromNow = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe("myOpenTasks", () => {
  it("includes only the given user's non-done tasks", () => {
    const tasks = [
      task("mine-open", { userId: "u1", status: "doing" }),
      task("mine-done", { userId: "u1", status: "done" }),
      task("not-mine", { userId: "u2", status: "doing" }),
    ];
    expect(myOpenTasks(tasks, "u1").map((t) => t.ref.id)).toEqual(["mine-open"]);
  });
});

describe("myOverdueTasks", () => {
  it("excludes tasks with no due date", () => {
    const tasks = [task("undated", { userId: "u1", status: "todo" })];
    expect(myOverdueTasks(tasks, "u1", NOW)).toHaveLength(0);
  });

  it("excludes done tasks even if overdue", () => {
    const tasks = [task("done-overdue", { userId: "u1", status: "done", dueDate: daysFromNow(-5) })];
    expect(myOverdueTasks(tasks, "u1", NOW)).toHaveLength(0);
  });

  it("excludes tasks not due yet", () => {
    const tasks = [task("future", { userId: "u1", status: "todo", dueDate: daysFromNow(2) })];
    expect(myOverdueTasks(tasks, "u1", NOW)).toHaveLength(0);
  });

  it("excludes tasks due today", () => {
    const tasks = [task("today", { userId: "u1", status: "todo", dueDate: daysFromNow(0) })];
    expect(myOverdueTasks(tasks, "u1", NOW)).toHaveLength(0);
  });

  it("includes an open task with a past due date", () => {
    const tasks = [task("overdue", { userId: "u1", status: "doing", dueDate: daysFromNow(-3) })];
    expect(myOverdueTasks(tasks, "u1", NOW).map((t) => t.ref.id)).toEqual(["overdue"]);
  });

  it("excludes another user's overdue task", () => {
    const tasks = [task("theirs", { userId: "u2", status: "todo", dueDate: daysFromNow(-3) })];
    expect(myOverdueTasks(tasks, "u1", NOW)).toHaveLength(0);
  });
});

describe("sortByUrgency", () => {
  it("orders most-overdue first, then soonest-due, undated last", () => {
    const tasks = [
      task("undated", { dueDate: null }),
      task("soon", { dueDate: daysFromNow(2) }),
      task("very-overdue", { dueDate: daysFromNow(-10) }),
      task("slightly-overdue", { dueDate: daysFromNow(-1) }),
    ];
    expect(sortByUrgency(tasks).map((t) => t.ref.id)).toEqual(["very-overdue", "slightly-overdue", "soon", "undated"]);
  });

  it("does not mutate the input array", () => {
    const tasks = [task("b", { dueDate: daysFromNow(2) }), task("a", { dueDate: daysFromNow(1) })];
    const original = [...tasks];
    sortByUrgency(tasks);
    expect(tasks).toEqual(original);
  });
});
