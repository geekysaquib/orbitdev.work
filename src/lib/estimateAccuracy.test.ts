import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task } from "./types";

const selectMock = vi.fn();
vi.mock("./supabase", () => ({
  supabase: { from: () => ({ select: () => ({ in: (...args: unknown[]) => selectMock(...args) }) }) },
}));

const { fetchEstimateAccuracy } = await import("./estimateAccuracy");

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1", title: "Task", status: "todo", priority: "med", project_id: "p1",
    estimate_minutes: null, created_at: new Date().toISOString(),
    ...over,
  } as Task;
}

beforeEach(() => { selectMock.mockReset(); });

describe("fetchEstimateAccuracy", () => {
  it("returns an empty list when no task has an estimate, without querying", async () => {
    const rows = await fetchEstimateAccuracy([task({ estimate_minutes: null })]);
    expect(rows).toEqual([]);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("computes variance for a task with logged time", async () => {
    selectMock.mockResolvedValue({ data: [{ task_id: "t1", seconds: 1800 }, { task_id: "t1", seconds: 1800 }], error: null });
    const rows = await fetchEstimateAccuracy([task({ id: "t1", estimate_minutes: 45 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taskId: "t1", estimateMinutes: 45, actualMinutes: 60, varianceMinutes: 15 });
    expect(rows[0].variancePct).toBe(33);
  });

  it("still includes a task with an estimate but zero logged time", async () => {
    selectMock.mockResolvedValue({ data: [], error: null });
    const rows = await fetchEstimateAccuracy([task({ id: "t1", estimate_minutes: 30 })]);
    expect(rows).toEqual([expect.objectContaining({ taskId: "t1", actualMinutes: 0, varianceMinutes: -30 })]);
  });

  it("sorts by absolute variance, largest first", async () => {
    selectMock.mockResolvedValue({
      data: [{ task_id: "small", seconds: 600 }, { task_id: "big", seconds: 12000 }],
      error: null,
    });
    const rows = await fetchEstimateAccuracy([
      task({ id: "small", estimate_minutes: 10 }),
      task({ id: "big", estimate_minutes: 10 }),
    ]);
    expect(rows.map((r) => r.taskId)).toEqual(["big", "small"]);
  });

  it("throws when the query errors", async () => {
    selectMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(fetchEstimateAccuracy([task({ estimate_minutes: 10 })])).rejects.toThrow("boom");
  });
});
