import { test, expect } from "@playwright/test";
import { fetchVerifiedUser, signInAs, env } from "./helpers/session";

/**
 * End-to-end proof that the automation engine is wired correctly through the
 * real UI: create a "when a task moves to done, notify me" rule, drag a task
 * to Done on the Kanban board, and confirm the rule's run counter increments
 * — i.e. Tasks.tsx's fireAsync() call actually reaches src/lib/automation.ts's
 * matcher and persists a run, not just that matchesTrigger() is correct in
 * isolation (already covered by the unit tests in Phase 2).
 */
const RULE_NAME = "[ORBIT-TEST] notify on task done";
const TASK_TITLE = `[ORBIT-TEST] automation task ${Date.now()}`;

// src/components/Select.tsx is a custom button+portal dropdown, not a native
// <select> — clicking the trigger button opens a popup rendered to document.body.
async function pickCustomSelect(triggerButton: import("@playwright/test").Locator, optionText: string) {
  await triggerButton.click();
  await triggerButton.page().locator(".uisel-opt", { hasText: optionText }).click();
}

test.describe.serial("automation: task_status trigger fires from the Kanban board", () => {
  test.beforeEach(async ({ context }) => {
    const user = await fetchVerifiedUser();
    await signInAs(context, user);
  });

  test("create the rule", async ({ page }) => {
    await page.goto("/automation");
    await page.getByRole("button", { name: "New rule" }).click();
    await page.getByPlaceholder("e.g. Close ticket when task is done").fill(RULE_NAME);
    // Trigger defaults to "task_status" / action to "notify" — just narrow the
    // status filter and set a notification title so the run is identifiable.
    const whenTriggers = page.locator(".auto-form-sec").first().locator(".uisel-trigger");
    await pickCustomSelect(whenTriggers.nth(1), "done");
    await page.getByPlaceholder("Notification title").fill(RULE_NAME);
    await page.getByRole("button", { name: "Create rule" }).click();
    await expect(page.getByText(RULE_NAME)).toBeVisible();
    await expect(page.getByText(/Ran 0 times/)).toBeVisible();
  });

  test("dragging a task to Done fires the rule", async ({ page }) => {
    await page.goto("/tasks");
    await page.getByPlaceholder("Add a task and press Enter").fill(TASK_TITLE);
    await page.getByPlaceholder("Add a task and press Enter").press("Enter");
    const card = page.locator(".ttask", { hasText: TASK_TITLE });
    await expect(card).toBeVisible();

    // Tasks.tsx's drop handler never reads event.dataTransfer — it only tracks
    // dragId in React state — so Playwright's higher-level dragTo() (which
    // doesn't reliably synthesize native HTML5 dragstart/dragover/drop for a
    // draggable=true element) is swapped for direct native DragEvents sharing
    // one live DataTransfer JSHandle, per Playwright's own dispatchEvent docs.
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await card.dispatchEvent("dragstart", { dataTransfer });
    const doneCol = page.locator(".tcol", { hasText: "Done" });
    await doneCol.dispatchEvent("dragover", { dataTransfer });
    await doneCol.dispatchEvent("drop", { dataTransfer });
    await card.dispatchEvent("dragend", { dataTransfer });

    await expect(page.locator(".ttask.done", { hasText: TASK_TITLE })).toBeVisible({ timeout: 10000 });

    await page.goto("/automation");
    const ruleCard = page.locator(".auto-rule", { hasText: RULE_NAME });
    await expect(ruleCard.getByText(/Ran 1 time/)).toBeVisible({ timeout: 10000 });
  });

  test("cleanup: delete the test rule, task, and notification", async ({ page }) => {
    await page.goto("/tasks");
    const card = page.locator(".ttask", { hasText: TASK_TITLE });
    if (await card.count()) await card.getByTitle("Delete").click();

    await page.goto("/automation");
    const ruleCard = page.locator(".auto-rule", { hasText: RULE_NAME });
    if (await ruleCard.count()) await ruleCard.getByRole("button", { name: "Delete" }).click();

    const user = await fetchVerifiedUser();
    await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/notifications?title=eq.${encodeURIComponent(RULE_NAME)}&user_id=eq.${user.id}`, {
      method: "DELETE",
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
  });
});
