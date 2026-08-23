/**
 * RBAC guard — enforced in the service layer, not only in UI (Section 4.7).
 * Covered by mandatory unit tests (Section 8.4).
 */

export type Role = "admin" | "ops" | "supplier" | "buyer";

export interface Actor {
  userId: string;
  role: Role;
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Role hierarchy: admin ⊇ ops. supplier/buyer are disjoint. */
const IMPLIES: Record<Role, Role[]> = {
  admin: ["admin", "ops"],
  ops: ["ops"],
  supplier: ["supplier"],
  buyer: ["buyer"],
};

export function hasRole(actor: Actor, required: Role): boolean {
  return IMPLIES[actor.role]?.includes(required) ?? false;
}

export function requireRole(actor: Actor | null | undefined, required: Role): Actor {
  if (!actor) throw new ForbiddenError("Not authenticated");
  if (!hasRole(actor, required)) {
    throw new ForbiddenError(
      `Requires role '${required}', actor has '${actor.role}'`,
    );
  }
  return actor;
}

export function requireAnyRole(
  actor: Actor | null | undefined,
  required: Role[],
): Actor {
  if (!actor) throw new ForbiddenError("Not authenticated");
  if (!required.some((role) => hasRole(actor, role))) {
    throw new ForbiddenError(
      `Requires one of [${required.join(", ")}], actor has '${actor.role}'`,
    );
  }
  return actor;
}
