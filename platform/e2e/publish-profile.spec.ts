import { expect, test } from "@playwright/test";
import { uniqueName } from "./helpers";

/** Critical flow 2: a supplier registers, creates their company and the
 * public profile at its permanent URL renders */
test("supplier publishes a company profile", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const email = `e2e-supplier-${stamp}@example.com`;
  const companyName = uniqueName("E2E Profile UAB");

  // Register as a company
  await page.goto("/en/register");
  await page.getByRole("button", { name: "We are a company" }).click();
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.locator("#email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/portal/);

  // Create the company profile
  await page.getByLabel("Company name").fill(companyName);
  await page.getByLabel("Country").selectOption("LT");
  await page.getByLabel("City").fill("Kaunas");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page.getByRole("heading", { name: companyName })).toBeVisible();

  // Public profile at the permanent URL
  await page.getByRole("link", { name: "View public profile" }).click();
  await expect(page).toHaveURL(/\/en\/company\//);
  await expect(page.getByRole("heading", { name: companyName })).toBeVisible();
  await expect(page.getByText("Not verified").first()).toBeVisible();
});
