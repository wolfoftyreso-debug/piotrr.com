import { expect, test } from "@playwright/test";

import { OPS_EMAIL, OPS_PASSWORD, signIn, uniqueName } from "./helpers";

/** Critical flow 1: ops onboards and verifies a supplier; badge appears.
 * 13 requirement items × 3 transitions = many server actions — allow time. */
test("ops verifies a supplier end-to-end", async ({ page }) => {
  test.setTimeout(420_000);
  await signIn(page, OPS_EMAIL, OPS_PASSWORD);

  // Own auth (Appendix B): the session must be an opaque, HttpOnly cookie —
  // not a readable token, and not reachable from document.cookie.
  const cookie = (await page.context().cookies()).find((c) =>
    c.name.endsWith("bb_session"),
  );
  expect(cookie, "a session cookie is set on sign-in").toBeTruthy();
  expect(cookie!.httpOnly, "session cookie is HttpOnly").toBe(true);
  expect(cookie!.sameSite, "session cookie is SameSite=Lax").toBe("Lax");
  // Opaque: a JWT would have two dots and decode to readable claims.
  expect(cookie!.value.split(".").length, "session token is not a JWT").toBe(1);
  expect(
    await page.evaluate(() => document.cookie),
    "session cookie is invisible to scripts",
  ).not.toContain(cookie!.value);

  // Create the company
  const name = uniqueName("E2E Weld UAB");
  await page.goto("/en/admin/companies");
  await page.getByLabel("Company name").fill(name);
  await page.getByLabel("Country").fill("LT");
  await page.getByLabel("Registration number").fill("309999999");
  await page.getByRole("button", { name: "Create" }).click();

  // Open the 360 view, add a worker, open the case
  await page.getByRole("link", { name }).click();
  await page.waitForURL(/\/admin\/companies\/[0-9a-f-]{36}/);
  // The contacts form reuses the same label — target the workers input by id
  await page.locator("#worker-name").fill("E2E Welder");
  await page.getByRole("button", { name: "Add worker" }).click();
  // The destination is an explicit choice — verification means something
  // different per country, so ops picks it rather than inheriting a default.
  await page
    .getByLabel(/Destination \(determines the requirement catalogue\)/)
    .selectOption({ label: "Sweden (lt-se)" });
  await page.getByRole("button", { name: /Open verification case/ }).click();
  await page.getByRole("link", { name: "→" }).click();
  await expect(page.getByRole("heading", { name: /Verification case/ })).toBeVisible();

  // Send to review, then walk every item to approved
  await page.getByRole("button", { name: "Send to review" }).click();

  async function clickAll(name: string, exact = false) {
    const locator = page.getByRole("button", { name, exact });
    for (;;) {
      const before = await locator.count();
      if (before === 0) break;
      await locator.first().click();
      // Each click is a server action + revalidate; wait for the row to flip
      await expect(locator).toHaveCount(before - 1, { timeout: 30_000 });
    }
  }
  await clickAll("Mark submitted");
  await clickAll("Start review");

  // Approving a critical requirement now demands recorded evidence — a
  // document or a written basis (verification/service.ts). The reviewer
  // types the basis into the note beside each Approve button; walk the
  // forms filling it before clicking, which is exactly what the guard
  // forces a real reviewer to do.
  for (;;) {
    const approveForms = page.locator('form:has(button:text-is("Approve"))');
    const count = await approveForms.count();
    if (count === 0) break;
    const form = approveForms.first();
    await form.locator('input[name="decisionNote"]').fill("Evidence reviewed on file");
    await form.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(approveForms).toHaveCount(count - 1, { timeout: 30_000 });
  }

  // Verify the case — the binary badge appears, names the destination the
  // case actually covers, and does so as a localized country name rather
  // than a raw ISO code.
  await page.getByRole("button", { name: "Mark verified" }).click();
  await expect(page.getByText("Verified for work in Sweden")).toBeVisible();
  await expect(page.getByText(/Verified for work in [A-Z]{2}\b/)).toHaveCount(0);
});
