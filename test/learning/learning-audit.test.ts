import { describe, expect, it } from "vitest";
import type { LearnedGrant } from "#src/learning/session-learning-store";
import { SessionLearningStore } from "#src/learning/session-learning-store";

const grant: LearnedGrant = {
  id: "lg-audit",
  status: "active",
  matcher: { kind: "exact", intentFingerprint: "sha256:audit" },
  scope: { sources: ["tool_call"], agents: ["agent-1"] },
  coveredGateSurfaces: ["bash"],
  expiresAt: 2_000,
  maxUses: 3,
  committedUses: 1,
  reservedUses: 0,
};

describe("learned grant audit and explain", () => {
  it("explains active grants with provenance and remaining use data", () => {
    const store = new SessionLearningStore({ now: () => 1_000 });
    store.createGrant(grant);

    expect(store.explain("sha256:audit")).toMatchObject({
      matched: true,
      grantId: "lg-audit",
      remainingUses: 2,
      expiresAt: 2_000,
    });
  });

  it("revokes grants and explains the revocation reason", () => {
    const store = new SessionLearningStore({ now: () => 1_000 });
    store.createGrant(grant);

    expect(store.revoke("lg-audit", "user denied this pattern")).toBe(true);

    expect(store.explain("sha256:audit")).toMatchObject({
      matched: false,
      reason: "revoked",
      grantId: "lg-audit",
      revocationReason: "user denied this pattern",
    });
  });

  it("returns false when revoking an unknown grant", () => {
    const store = new SessionLearningStore({ now: () => 1_000 });

    expect(store.revoke("missing", "not found")).toBe(false);
  });
});
