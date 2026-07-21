import { test, expect } from "@playwright/test";
import { fetchVerifiedUser, signInAs } from "./helpers/session";

test("Ask AI: open the modal, ask a question, get an answer or a graceful error", async ({ context, page }) => {
  test.setTimeout(120000); // local-model fallback can be slow on CPU — see the comment below
  const user = await fetchVerifiedUser();
  await signInAs(context, user);
  await page.goto("/app");

  await page.getByRole("button", { name: "Ask AI" }).click();
  const input = page.getByPlaceholder("Ask about your work…");
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill("How many open tasks do I have?");

  // submit() is a silent no-op while contextReady is still false (the app
  // gathers projects/tasks/tickets/sprints before allowing a question) — the
  // accent send button's disabled state is the real readiness signal, so wait
  // for it rather than pressing Enter blind and having nothing happen.
  const sendBtn = page.locator(".dk-field .btn.accent");
  await expect(sendBtn).toBeEnabled({ timeout: 30000 });
  await sendBtn.click();

  // The account's Anthropic key is known to be out of credit (see Phase 4
  // findings), so this exercises the real provider-fallback chain down to
  // whatever the account has next — possibly the local model, which is slow
  // on CPU — hence the generous timeout. Either a real answer bubble or a
  // surfaced error is an acceptable, non-hanging outcome; a silent hang isn't.
  const answer = page.locator(".ai-answer").last();
  const error = page.locator(".pg-error");
  await expect(answer.or(error)).toBeVisible({ timeout: 90000 });
});
