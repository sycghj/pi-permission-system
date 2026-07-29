import { describe, expect, it, vi } from "vitest";

import { GateRunner } from "#src/handlers/gates/runner";
import { makeDescriptor, makeReporter } from "#test/helpers/gate-fixtures";
import { makeCheckResult } from "#test/helpers/handler-fixtures";

type RunnerCtor = new (...args: unknown[]) => GateRunner;

function makeLearnedRunner(options: {
  checkState?: "allow" | "ask" | "deny";
  checkSource?: string;
  learnedResult?: unknown;
}) {
  const resolve = vi.fn().mockReturnValue(
    makeCheckResult({
      state: options.checkState ?? "ask",
      source: options.checkSource as never,
      matchedPattern: "*",
    }),
  );
  const recordSessionApproval = vi.fn();
  const escalate = vi
    .fn()
    .mockResolvedValue({ approved: true, state: "approved" });
  const reporter = makeReporter();
  const autoDecide = vi.fn().mockResolvedValue({
    approved: true,
    state: "approved",
    autoApproved: true,
  });
  const learned = {
    evaluateAsk: vi
      .fn()
      .mockReturnValue(options.learnedResult ?? { action: "miss" }),
  };
  const runner = new (GateRunner as unknown as RunnerCtor)(
    { resolve },
    { recordSessionApproval },
    { escalate },
    reporter,
    { decide: autoDecide },
    learned,
  );
  return { runner, deps: { learned, autoDecide, escalate, reporter } };
}

describe("GateRunner learned grants", () => {
  it("allows an ask-state gate from a learned grant before auto-mode", async () => {
    const { runner, deps } = makeLearnedRunner({
      learnedResult: { action: "allow", grantId: "lg-1", reservationId: "r-1" },
    });

    await expect(
      runner.run(makeDescriptor({ surface: "bash" }), "agent-1", "tc-1"),
    ).resolves.toEqual({ action: "allow" });
    expect(deps.learned.evaluateAsk).toHaveBeenCalledOnce();
    expect(deps.autoDecide).not.toHaveBeenCalled();
    expect(deps.escalate).not.toHaveBeenCalled();
    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith(
      "learning.evaluated",
      expect.objectContaining({
        toolCallId: "tc-1",
        agentName: "agent-1",
        surface: "bash",
      }),
    );
    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith(
      "learning.allowed",
      expect.objectContaining({
        toolCallId: "tc-1",
        agentName: "agent-1",
        surface: "bash",
        learnedGrantId: "lg-1",
      }),
    );
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({ result: "allow", resolution: "learned_grant" }),
    );
  });

  it("does not call learned grants for deny, allow, or session checks", async () => {
    for (const options of [
      { checkState: "deny" as const },
      { checkState: "allow" as const },
      { checkState: "ask" as const, checkSource: "session" },
    ]) {
      const { runner, deps } = makeLearnedRunner(options);
      await runner
        .run(makeDescriptor(), "agent-1", "tc-1")
        .catch(() => undefined);
      expect(deps.learned.evaluateAsk).not.toHaveBeenCalled();
    }
  });

  it("continues to auto-mode and prompt behavior on learned miss", async () => {
    const { runner, deps } = makeLearnedRunner({
      learnedResult: { action: "miss" },
    });

    await expect(
      runner.run(makeDescriptor(), "agent-1", "tc-1"),
    ).resolves.toEqual({ action: "allow" });
    expect(deps.learned.evaluateAsk).toHaveBeenCalledOnce();
    expect(deps.autoDecide).toHaveBeenCalledOnce();
    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith(
      "learning.missed",
      expect.objectContaining({
        toolCallId: "tc-1",
        agentName: "agent-1",
      }),
    );
    expect(deps.escalate).not.toHaveBeenCalled();
  });
});
