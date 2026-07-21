import { test, expect } from "@playwright/test";
import { fetchVerifiedUser, signInAs } from "./helpers/session";

test("TimeTracking: start then stop the Orbit focus timer", async ({ context, page }) => {
  const user = await fetchVerifiedUser();
  await signInAs(context, user);
  await page.goto("/time");

  const main = page.locator("main.page");
  const toggleBtn = main.getByRole("button", { name: /^(Start|Stop & log)$/ });
  // The button is disabled until useAgent() confirms the local agent is
  // online (polled) — give it a moment rather than assuming it's instant.
  await expect(toggleBtn).toBeEnabled({ timeout: 15000 });

  const label = await toggleBtn.textContent();
  // A timer already running could be the account owner's real, live work
  // session (this account is in active use elsewhere) — never assume it's
  // test leftover and stop it. Skip rather than risk cutting off real time.
  test.skip(!!label?.includes("Stop"), "A timer is already running on this account — not touching a possibly-real session.");

  await toggleBtn.click();
  await expect(main.getByRole("button", { name: "Stop & log" })).toBeVisible({ timeout: 10000 });

  await main.getByRole("button", { name: "Stop & log" }).click();
  await expect(main.getByRole("button", { name: "Start", exact: true })).toBeVisible({ timeout: 10000 });
});
