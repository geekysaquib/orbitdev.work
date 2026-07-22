# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: routes-smoke.spec.ts >> authenticated route crawl >> /health loads without redirecting to /login or throwing
- Location: e2e\routes-smoke.spec.ts:24:5

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8888/health
Call log:
  - navigating to "http://localhost:8888/health", waiting until "load"

```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | import { fetchVerifiedUser, signInAs } from "./helpers/session";
  3  | 
  4  | /**
  5  |  * Loads every authenticated route once and asserts it renders past the Guard
  6  |  * (no redirect back to /login) with no uncaught page error. This is a crawl,
  7  |  * not a feature test of each page's content — it exists to catch "route
  8  |  * throws / never mounts" regressions cheaply across all 20 authenticated
  9  |  * routes in one pass, since ORBIT has no existing coverage of this at all.
  10 |  */
  11 | const ROUTES = [
  12 |   "/app", "/projects", "/teams", "/tickets", "/sprints", "/tasks", "/docker",
  13 |   "/postgres", "/mail", "/calendar", "/time", "/notifications", "/docs",
  14 |   "/audit", "/automation", "/health", "/insights", "/settings",
  15 | ];
  16 | 
  17 | test.describe("authenticated route crawl", () => {
  18 |   test.beforeEach(async ({ context }) => {
  19 |     const user = await fetchVerifiedUser();
  20 |     await signInAs(context, user);
  21 |   });
  22 | 
  23 |   for (const route of ROUTES) {
  24 |     test(`${route} loads without redirecting to /login or throwing`, async ({ page }) => {
  25 |       const pageErrors: string[] = [];
  26 |       page.on("pageerror", (e) => pageErrors.push(e.message));
  27 | 
> 28 |       await page.goto(route);
     |                  ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8888/health
  29 |       await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  30 | 
  31 |       expect(page.url()).not.toContain("/login");
  32 |       expect(pageErrors, `uncaught page errors on ${route}: ${pageErrors.join(" | ")}`).toEqual([]);
  33 |     });
  34 |   }
  35 | });
  36 | 
```