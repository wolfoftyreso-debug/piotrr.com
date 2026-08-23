import type { Page } from "@playwright/test";

export const OPS_EMAIL = "ops@piotrr.example";
export const OPS_PASSWORD = "change-me-now";

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/en/signin");
  await page.locator("#email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(admin|portal)/);
}

export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`;
}
