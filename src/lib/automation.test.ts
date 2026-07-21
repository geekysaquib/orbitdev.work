import { describe, it, expect } from "vitest";
import { matchesTrigger, type AutomationRule, type AutomationEvent } from "./automation";

function rule(overrides: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: "r1", name: "Test rule", enabled: true,
    triggerType: "task_status", triggerConfig: {},
    actionType: "notify", actionConfig: {},
    runCount: 0, lastRunAt: null, createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const taskEvent = (over: Partial<Extract<AutomationEvent, { type: "task_status" }>> = {}): AutomationEvent => ({
  type: "task_status", taskId: "t1", title: "Fix bug", status: "done", priority: "high", projectId: "p1",
  ...over,
});

describe("matchesTrigger", () => {
  it("does not match a disabled rule", () => {
    expect(matchesTrigger(rule({ enabled: false }), taskEvent())).toBe(false);
  });

  it("does not match a different trigger type", () => {
    expect(matchesTrigger(rule({ triggerType: "ticket_status" }), taskEvent())).toBe(false);
  });

  it("matches when no filters are set (any status)", () => {
    expect(matchesTrigger(rule(), taskEvent({ status: "done" }))).toBe(true);
    expect(matchesTrigger(rule(), taskEvent({ status: "todo" }))).toBe(true);
  });

  it("filters on trigger_config.to against the event's status", () => {
    const r = rule({ triggerConfig: { to: "done" } });
    expect(matchesTrigger(r, taskEvent({ status: "done" }))).toBe(true);
    expect(matchesTrigger(r, taskEvent({ status: "todo" }))).toBe(false);
  });

  it("filters on trigger_config.projectId", () => {
    const r = rule({ triggerConfig: { projectId: "p1" } });
    expect(matchesTrigger(r, taskEvent({ projectId: "p1" }))).toBe(true);
    expect(matchesTrigger(r, taskEvent({ projectId: "p2" }))).toBe(false);
    expect(matchesTrigger(r, taskEvent({ projectId: null }))).toBe(false);
  });

  it("requires every extra condition to match (AND)", () => {
    const r = rule({
      triggerConfig: {
        conditions: [
          { field: "priority", op: "eq", value: "high" },
          { field: "title", op: "contains", value: "bug" },
        ],
      },
    });
    expect(matchesTrigger(r, taskEvent({ priority: "high", title: "Fix bug" }))).toBe(true);
    expect(matchesTrigger(r, taskEvent({ priority: "low", title: "Fix bug" }))).toBe(false);
    expect(matchesTrigger(r, taskEvent({ priority: "high", title: "Add feature" }))).toBe(false);
  });

  it("condition matching is case-insensitive", () => {
    const r = rule({ triggerConfig: { conditions: [{ field: "priority", op: "eq", value: "HIGH" }] } });
    expect(matchesTrigger(r, taskEvent({ priority: "high" }))).toBe(true);
  });

  it("is defensive against fields absent on the event (timer events have no title/priority)", () => {
    const r = rule({
      triggerType: "timer_started",
      triggerConfig: { conditions: [{ field: "title", op: "contains", value: "x" }] },
    });
    const timerEvent: AutomationEvent = { type: "timer_started", projectId: "p1", taskId: null };
    expect(matchesTrigger(r, timerEvent)).toBe(false);
  });
});
