import { describe, expect, it } from "vitest";
import { chooseStaffSeedPassword } from "./seed-support";

/**
 * The staff seed password. The bug this guards: the seed hard-coded
 * "change-me-now" — published in three documents — and the documented
 * k8s first boot ran that seed against production, where NODE_ENV is not
 * set in the seed Job and no environment guard can fire. The default is
 * therefore inverted: random unless a password is asked for explicitly.
 */
describe("staff seed password", () => {
  it("generates a random password when nothing is asked for", () => {
    const a = chooseStaffSeedPassword(undefined);
    const b = chooseStaffSeedPassword(undefined);
    expect(a.generated).toBe(true);
    expect(a.password).not.toBe(b.password);
    expect(a.password.length).toBeGreaterThanOrEqual(20);
    expect(a.password).not.toBe("change-me-now");
  });

  it("treats the empty string as nothing asked for, not as a password", () => {
    expect(chooseStaffSeedPassword("").generated).toBe(true);
  });

  it("honours an explicit dev password", () => {
    const chosen = chooseStaffSeedPassword("change-me-now");
    expect(chosen).toEqual({ password: "change-me-now", generated: false });
  });

  it("refuses a password below the registration floor", () => {
    expect(() => chooseStaffSeedPassword("short")).toThrow(/at least 10/);
  });
});
