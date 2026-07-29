import { describe, expect, it, vi } from "vitest";

import { GateRunner } from "#src/handlers/gates/runner";
import { makeDescriptor, makeReporter } from "#test/helpers/gate-fixtures";
import { makeCheckResult } from "#test/helpers/handler-fixtures";

type RunnerCtor = new (...args: unknown[]) => GateRunner;

function makeRunner(options: {
  checkState?: "allow" | "ask" | "deny";
  checkSource?: string;
  autoDecide?: unknown;
  escalate?: unknown;
}) {
  const resolve = vi.fn().mockReturnValue(
    makeCheckResult({
      state: options.checkState ?? "ask",
      source: options.checkSource as never,
      matchedPattern: "*",
    }),
  );
  const evidence = { record: vi.fn() };
  const reporter = makeReporter();
  const runner = new (GateRunner as unknown as RunnerCtor)(
    { resolve },
    { recordSessionApproval: vi.fn() },
    {
      escalate:
        options.escalate ??
        vi.fn().mockResolvedValue({ approved: true, state: "approved" }),
    },
    reporter,
    options.autoDecide ? { decide: options.autoDecide } : undefined,
    undefined,
    evidence,
  );
  return { runner, evidence, reporter };
}

describe("GateRunner evidence recording", () => {
  it("records independent evidence for direct human approval", async () => {
    const { runner, evidence, reporter } = makeRunner({});

    await expect(
      runner.run(makeDescriptor(), "agent-1", "tc-1"),
    ).resolves.toEqual({ action: "allow" });

    expect(evidence.record).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: "tc-1",
        agentName: "agent-1",
        decision: "approved",
        independentlyUserApproved: true,
      }),
    );
    expect(reporter.writeReviewLog).toHaveBeenCalledWith(
      "learning.evidence_recorded",
      expect.objectContaining({
        toolCallId: "tc-1",
        agentName: "agent-1",
        decision: "approved",
        independentlyUserApproved: true,
      }),
    );
  });

  it("records direct human denial without marking it approved", async () => {
    const { runner, evidence } = makeRunner({
      escalate: vi.fn().mockResolvedValue({
        approved: false,
        state: "denied_with_reason",
        denialReason: "too broad",
      }),
    });

    await expect(
      runner.run(makeDescriptor(), "agent-1", "tc-1"),
    ).resolves.toMatchObject({ action: "block" });

    expect(evidence.record).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "denied",
        independentlyUserApproved: false,
        denialReason: "too broad",
      }),
    );
  });

  it("does not record evidence for auto-mode or session approvals", async () => {
    const auto = makeRunner({
      autoDecide: vi.fn().mockResolvedValue({
        approved: true,
        state: "approved",
        autoApproved: true,
      }),
    });
    await auto.runner.run(makeDescriptor(), "agent-1", "tc-auto");
    expect(auto.evidence.record).not.toHaveBeenCalled();

    const session = makeRunner({ checkState: "ask", checkSource: "session" });
    await session.runner.run(makeDescriptor(), "agent-1", "tc-session");
    expect(session.evidence.record).not.toHaveBeenCalled();
  });
});
