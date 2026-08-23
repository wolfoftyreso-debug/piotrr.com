import { expect, test } from "@playwright/test";
import { OPS_EMAIL, OPS_PASSWORD, signIn } from "./helpers";

/**
 * Critical flow 4: the Content-Security-Policy differs by area, and both
 * halves have to hold at once — strict where a session lives, and the
 * pages there still working.
 *
 * Removing 'unsafe-inline' globally was measured and it broke every page:
 * Next streams its RSC payload through inline scripts. So the policy is
 * nonced on /admin and /portal (already rendered per request, nothing
 * lost) and left permissive on the 171 prerendered public pages, which
 * carry no session. This test is what stops that split from silently
 * collapsing to the weaker half.
 */
test("admin runs under a nonce CSP, public keeps its prerendered policy", async ({ page }) => {
  test.setTimeout(180_000);
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text().slice(0, 130));
  });

  await signIn(page, OPS_EMAIL, OPS_PASSWORD);

  for (const url of ["/en/admin", "/en/admin/queue", "/en/admin/companies"]) {
    violations.length = 0;
    const response = await page.goto(url, { waitUntil: "networkidle" });
    const scriptSrc =
      (response!.headers()["content-security-policy"] ?? "").match(/script-src[^;]*/)?.[0] ?? "";

    expect(scriptSrc, `${url} carries a nonce`).toContain("'nonce-");
    expect(scriptSrc, `${url} forbids inline script`).not.toContain("unsafe-inline");
    // The point of the exercise: the page must still work.
    expect(
      await page.evaluate(() => document.body.innerText.length),
      `${url} rendered content`,
    ).toBeGreaterThan(200);
    expect(violations, `${url} raised no CSP violations`).toEqual([]);
  }

  // Public pages keep a policy at all — moving the CSP into middleware
  // once shipped them with none, because only one branch set it.
  const pub = await page.goto("/sv");
  expect(pub!.headers()["content-security-policy"], "public CSP present").toBeTruthy();
});
