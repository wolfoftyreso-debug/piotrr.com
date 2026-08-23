import { expect, test } from "@playwright/test";
import { OPS_EMAIL, OPS_PASSWORD, signIn, uniqueName } from "./helpers";

/** Critical flow 3: anonymous buyer RFQ → ops qualifies + dispatches →
 * supplier offers (snapshot frozen) → accept → deal recorded */
test("RFQ goes from buyer submission to a recorded deal", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const title = uniqueName("E2E Pipework");

  // 1. Anonymous buyer submits the RFQ
  await page.goto("/en/request-work");
  await page.getByLabel("Your name").fill("E2E Buyer");
  await page.getByLabel("Your email").fill(`e2e-buyer-${stamp}@example.com`);
  // Buyers carry beställaransvar, so the form now identifies who is asking
  await page.getByLabel("Your company").fill("E2E Buyer AB");
  await page.getByLabel("Company registration number").fill("556000-0000");
  await page.getByLabel("Title").fill(title);
  await page
    .getByLabel("Description")
    .fill("E2E flow: stainless pipework, six welders, eight weeks, EN 1090 EXC2.");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("heading", { name: /Request received/ })).toBeVisible();

  // 2. Ops qualifies and dispatches to the verified demo supplier
  await signIn(page, OPS_EMAIL, OPS_PASSWORD);
  await page.goto("/en/admin/rfqs");
  await page.getByRole("link", { name: title }).click();
  await page.waitForURL(/\/admin\/rfqs\/[0-9a-f-]{36}/);
  await page.getByRole("button", { name: "Qualify" }).click();
  await page
    .getByRole("checkbox")
    .and(page.locator(`label:has-text("Vilnius Weldworks UAB") input`))
    .check();
  await page.getByRole("button", { name: "Dispatch", exact: true }).click();
  await expect(page.getByText("dispatched", { exact: false }).first()).toBeVisible();

  // 3. Supplier (demo seed account) submits an offer with a named team
  await page.goto("/en/signin");
  await signIn(page, "supplier1@demo.piotrr.example", "demo-password-123");
  await page.goto("/en/portal");
  await page.getByRole("link", { name: title }).click();
  await page.getByLabel("Price").fill("950000");
  await page.getByRole("checkbox").first().check();
  await page.getByLabel("What is included?").fill("Crew, WPQR docs, lodging.");
  await page.getByRole("button", { name: "Submit offer" }).click();
  await expect(page.getByText("verification frozen")).toBeVisible();

  // 4. Ops accepts the offer and records the deal
  await page.goto("/en/signin");
  await signIn(page, OPS_EMAIL, OPS_PASSWORD);
  await page.goto("/en/admin/rfqs");
  await page.getByRole("link", { name: title }).click();
  await page.waitForURL(/\/admin\/rfqs\/[0-9a-f-]{36}/);
  // Accept happens from the buyer room; ops has access too
  const rfqId = page.url().match(/rfqs\/([0-9a-f-]{36})/)?.[1];
  await page.goto(`/en/portal/rfq/${rfqId}`);
  await page.getByRole("button", { name: "Accept offer" }).click();
  await expect(page.getByText("accepted").first()).toBeVisible();

  await page.goto(`/en/admin/rfqs/${rfqId}`);
  await page.getByLabel("Contract value").fill("950000");
  await page.getByLabel("Success fee %").fill("8");
  await page.getByRole("button", { name: "Record deal" }).click();
  // Wait for the server action to land — the form is replaced by the receipt
  await expect(page.getByText("Deal recorded")).toBeVisible({ timeout: 30_000 });

  // 5. The deal shows up in /admin/deals ready for CSV export
  await page.goto("/en/admin/deals");
  await expect(page.getByText(title)).toBeVisible();
});
