import { describe, it, expect } from "vitest";
import { computeVelocity, velocityMetric, type SprintVelocity } from "./velocity";
import type { BoardSprint, ZohoItem } from "./zoho";

function item(status: string, points?: number): ZohoItem {
  return {
    id: `i-${Math.random()}`, ticketNumber: "1", subject: "x", status, priority: "med",
    points: points == null ? undefined : String(points),
  };
}
function sprint(id: string, name: string, items: ZohoItem[], startDate = ""): BoardSprint {
  return { id, name, status: "active", startDate, endDate: "", items };
}

describe("computeVelocity", () => {
  it("sums points only for done/closed/resolved/complete items", () => {
    const s = sprint("s1", "Sprint 1", [
      item("Done", 3),
      item("Closed", 2),
      item("Resolved", 1),
      item("Complete", 4),
      item("In Progress", 5),
      item("Open", 2),
    ]);
    const [row] = computeVelocity([s]);
    expect(row.points).toBe(10);
    expect(row.completedCount).toBe(4);
    expect(row.totalCount).toBe(6);
  });

  it("is case-insensitive on status", () => {
    const s = sprint("s1", "Sprint 1", [item("DONE", 5)]);
    const [row] = computeVelocity([s]);
    expect(row.completedCount).toBe(1);
    expect(row.points).toBe(5);
  });

  it("treats a missing points field as 0", () => {
    const s = sprint("s1", "Sprint 1", [item("Done")]);
    const [row] = computeVelocity([s]);
    expect(row.points).toBe(0);
  });
});

describe("velocityMetric", () => {
  it("uses points when any sprint has them", () => {
    const rows: SprintVelocity[] = [
      { sprintId: "1", sprintName: "S1", points: 5, completedCount: 2, totalCount: 4 },
      { sprintId: "2", sprintName: "S2", points: 0, completedCount: 3, totalCount: 3 },
    ];
    expect(velocityMetric(rows)).toEqual({ values: [5, 0], label: "points" });
  });

  it("falls back to completed-item counts when no sprint uses points", () => {
    const rows: SprintVelocity[] = [
      { sprintId: "1", sprintName: "S1", points: 0, completedCount: 2, totalCount: 4 },
      { sprintId: "2", sprintName: "S2", points: 0, completedCount: 3, totalCount: 3 },
    ];
    expect(velocityMetric(rows)).toEqual({ values: [2, 3], label: "items" });
  });

  it("returns empty arrays for no sprints", () => {
    expect(velocityMetric([])).toEqual({ values: [], label: "items" });
  });
});
