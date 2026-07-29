import { describe, expect, it } from "vitest";

import { LearnedGrantEvaluator } from "#src/learning/learned-grant-evaluator";
import { SessionLearningStore } from "#src/learning/session-learning-store";

function evaluator() {
  const store = new SessionLearningStore({ now: () => 1_000 });
  store.createGrant({
    id: "lg-1",
    status: "active",
    matcher: { kind: "exact", intentFingerprint: "sha256:abc" },
    scope: { sources: ["tool_call"], agents: ["agent-1"] },
    coveredGateSurfaces: ["bash"],
    expiresAt: 1_100,
    maxUses: 5,
    committedUses: 0,
    reservedUses: 0,
  });
  return new LearnedGrantEvaluator(store);
}

describe("LearnedGrantEvaluator", () => {
  it("allows only ask-state checks with a matching grant", () => {
    expect(
      evaluator().evaluateAsk({
        check: { state: "ask" },
        intentFingerprint: "sha256:abc",
        gateSurface: "bash",
        source: "tool_call",
        agentName: "agent-1",
        toolCallId: "tc-1",
      }),
    ).toMatchObject({ action: "allow", grantId: "lg-1" });
  });

  it("misses instead of allowing when no active grant matches", () => {
    expect(
      evaluator().evaluateAsk({
        check: { state: "ask" },
        intentFingerprint: "sha256:missing",
        gateSurface: "bash",
        source: "tool_call",
        agentName: "agent-1",
        toolCallId: "tc-1",
      }),
    ).toEqual({ action: "miss" });
  });

  it("does not expose an API that accepts allow or deny checks", () => {
    expect(() =>
      evaluator().evaluate({
        check: { state: "deny" },
        intentFingerprint: "sha256:abc",
        gateSurface: "bash",
        source: "tool_call",
        agentName: "agent-1",
        toolCallId: "tc-1",
      }),
    ).toThrow(/ask/i);
  });
});
