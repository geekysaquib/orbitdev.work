import { test, expect } from "@playwright/test";
import { fetchVerifiedUser, signInAs } from "./helpers/session";

/**
 * Loads every authenticated route once and asserts it renders past the Guard
 * (no redirect back to /login) with no uncaught page error. This is a crawl,
 * not a feature test of each page's content — it exists to catch "route
 * throws / never mounts" regressions cheaply across all 20 authenticated
 * routes in one pass, since ORBIT has no existing coverage of this at all.
 */
const ROUTES = [
  "/app", "/projects", "/teams", "/tickets", "/sprints", "/tasks", "/docker",
  "/postgres", "/mail", "/calendar", "/time", "/notifications", "/docs",
  "/audit", "/automation", "/health", "/insights", "/settings",
];

test.describe("authenticated route crawl", () => {
  test.beforeEach(async ({ context }) => {
    const user = await fetchVerifiedUser();
    await signInAs(context, user);
  });

  for (const route of ROUTES) {
    test(`${route} loads without redirecting to /login or throwing`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));

      await page.goto(route);
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

      expect(page.url()).not.toContain("/login");
      expect(pageErrors, `uncaught page errors on ${route}: ${pageErrors.join(" | ")}`).toEqual([]);
    });
  }
});
