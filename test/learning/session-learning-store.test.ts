import { describe, expect, it } from "vitest";
import type { LearnedGrant } from "#src/learning/session-learning-store";
import { SessionLearningStore } from "#src/learning/session-learning-store";

const grant: LearnedGrant = {
  id: "lg-1",
  status: "active",
  matcher: { kind: "exact", intentFingerprint: "sha256:abc" },
  scope: { sources: ["tool_call"], agents: ["agent-1"] },
  coveredGateSurfaces: ["bash"],
  expiresAt: 1_100,
  maxUses: 1,
  committedUses: 0,
  reservedUses: 0,
};

describe("SessionLearningStore", () => {
  it("reserves, commits, and exhausts a grant once", () => {
    const store = new SessionLearningStore({ now: () => 1_000 });
    store.createGrant(grant);

    const first = store.reserveMatch({
      intentFingerprint: "sha256:abc",
      gateSurface: "bash",
      source: "tool_call",
      agentName: "agent-1",
      toolCallId: "tc-1",
    });

    expect(first).toMatchObject({ grantId: "lg-1" });
    expect(
      store.reserveMatch({
        intentFingerprint: "sha256:abc",
        gateSurface: "bash",
        source: "tool_call",
        agentName: "agent-1",
        toolCallId: "tc-2",
      }),
    ).toBeNull();

    store.commitReservation(first?.reservationId ?? "missing");
    expect(store.explain("sha256:abc")).toMatchObject({
      matched: false,
      reason: "use-limit-exhausted",
    });
  });

  it("aborts a reservation without consuming use-count", () => {
    const store = new SessionLearningStore({ now: () => 1_000 });
    store.createGrant(grant);
    const reservation = store.reserveMatch({
      intentFingerprint: "sha256:abc",
      gateSurface: "bash",
      source: "tool_call",
      agentName: "agent-1",
      toolCallId: "tc-1",
    });

    store.abortReservation(reservation?.reservationId ?? "missing");

    expect(
      store.reserveMatch({
        intentFingerprint: "sha256:abc",
        gateSurface: "bash",
        source: "tool_call",
        agentName: "agent-1",
        toolCallId: "tc-2",
      }),
    ).toMatchObject({ grantId: "lg-1" });
  });

  it("misses expired, revoked, wrong-scope, and wrong-surface grants", () => {
    const store = new SessionLearningStore({ now: () => 1_200 });
    store.createGrant(grant);
    expect(store.explain("sha256:abc")).toMatchObject({
      matched: false,
      reason: "expired",
    });

    const active = new SessionLearningStore({ now: () => 1_000 });
    active.createGrant({ ...grant, status: "revoked" });
    expect(active.explain("sha256:abc")).toMatchObject({
      matched: false,
      reason: "revoked",
    });
    expect(
      active.reserveMatch({
        intentFingerprint: "sha256:abc",
        gateSurface: "path",
        source: "tool_call",
        agentName: "agent-1",
        toolCallId: "tc-1",
      }),
    ).toBeNull();
  });
});
