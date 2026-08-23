import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  hasRole,
  requireAnyRole,
  requireRole,
  type Actor,
} from "./rbac";

const actor = (role: Actor["role"]): Actor => ({ userId: "u1", role });

describe("RBAC guards", () => {
  it("admin implies ops", () => {
    expect(hasRole(actor("admin"), "ops")).toBe(true);
    expect(hasRole(actor("admin"), "admin")).toBe(true);
  });

  it("ops does not imply admin", () => {
    expect(hasRole(actor("ops"), "admin")).toBe(false);
    expect(() => requireRole(actor("ops"), "admin")).toThrow(ForbiddenError);
  });

  it("supplier and buyer are disjoint from ops", () => {
    expect(hasRole(actor("supplier"), "ops")).toBe(false);
    expect(hasRole(actor("buyer"), "ops")).toBe(false);
    expect(hasRole(actor("supplier"), "buyer")).toBe(false);
  });

  it("unauthenticated actors are rejected", () => {
    expect(() => requireRole(null, "ops")).toThrow(ForbiddenError);
    expect(() => requireAnyRole(undefined, ["ops", "admin"])).toThrow(
      ForbiddenError,
    );
  });

  it("requireAnyRole accepts any matching role", () => {
    expect(requireAnyRole(actor("ops"), ["admin", "ops"]).role).toBe("ops");
    expect(() => requireAnyRole(actor("buyer"), ["admin", "ops"])).toThrow(
      ForbiddenError,
    );
  });

  it("requireRole returns the actor for chaining", () => {
    expect(requireRole(actor("admin"), "ops").userId).toBe("u1");
  });
});
