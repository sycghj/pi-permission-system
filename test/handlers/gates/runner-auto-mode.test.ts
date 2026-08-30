import { describe, expect, it, vi } from "vitest";
import { makeDescriptor, makeGateRunner } from "#test/helpers/gate-fixtures";
import { makeCheckResult } from "#test/helpers/handler-fixtures";

describe("GateRunner auto ask decider", () => {
  it("auto-approves ask decisions without prompting when decider allows", async () => {
    const autoDecide = vi.fn().mockResolvedValue({
      approved: true,
      state: "approved",
      autoApproved: true,
    });
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      autoDecide,
    });

    const result = await runner.run(makeDescriptor(), null, "tc-1");

    expect(result).toEqual({ action: "allow" });
    expect(autoDecide).toHaveBeenCalledOnce();
    expect(deps.escalate).not.toHaveBeenCalled();
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "allow",
        resolution: "auto_approved",
        reason: { kind: "auto_mode", detail: "classifier_allow" },
      }),
    );
  });

  it("auto-denies ask decisions without prompting when decider denies", async () => {
    const autoDecide = vi.fn().mockResolvedValue({
      approved: false,
      state: "denied_with_reason",
      denialReason: "classifier blocked",
    });
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      autoDecide,
    });

    const result = await runner.run(makeDescriptor(), null, "tc-1");

    expect(result).toMatchObject({ action: "block" });
    expect(autoDecide).toHaveBeenCalledOnce();
    expect(deps.escalate).not.toHaveBeenCalled();
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "deny",
        resolution: "user_denied",
        reason: { kind: "auto_mode", detail: "classifier blocked" },
      }),
    );
  });

  it("returns human-review-required without prompting in automatic-only mode", async () => {
    const autoDecide = vi.fn().mockResolvedValue(null);
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      autoDecide,
    });

    const result = await runner.runAutomatic(
      makeDescriptor(),
      null,
      "tc-automatic",
    );

    expect(result).toEqual({
      action: "block",
      reason: "Automatic authorization did not resolve this ask.",
      manualReviewRequired: true,
    });
    expect(deps.escalate).not.toHaveBeenCalled();
    expect(deps.reporter.writeReviewLog).not.toHaveBeenCalled();
    expect(deps.reporter.emitDecision).not.toHaveBeenCalled();
  });

  it("marks an Auto Mode denial for human review in automatic-only mode", async () => {
    const autoDecide = vi.fn().mockResolvedValue({
      approved: false,
      state: "denied_with_reason",
      denialReason: "classifier blocked",
    });
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      autoDecide,
    });

    const result = await runner.runAutomatic(
      makeDescriptor(),
      null,
      "tc-automatic",
    );

    expect(result).toMatchObject({
      action: "block",
      manualReviewRequired: true,
    });
    expect(deps.escalate).not.toHaveBeenCalled();
    expect(deps.reporter.writeReviewLog).not.toHaveBeenCalled();
    expect(deps.reporter.emitDecision).not.toHaveBeenCalled();
  });

  it("falls back to the user prompt when decider abstains", async () => {
    const autoDecide = vi.fn().mockResolvedValue(null);
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      autoDecide,
      escalate: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" }),
    });

    const result = await runner.run(makeDescriptor(), null, "tc-1");

    expect(result).toEqual({ action: "allow" });
    expect(autoDecide).toHaveBeenCalledOnce();
    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith(
      "auto_mode.unresolved",
      expect.objectContaining({ reason: "no_decision", toolName: "read" }),
    );
    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith(
      "auto_mode.fallback_to_prompt",
      expect.objectContaining({ reason: "no_decision", toolName: "read" }),
    );
    expect(deps.escalate).toHaveBeenCalledOnce();
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "allow",
        resolution: "user_approved",
        reason: { kind: "manual_prompt" },
      }),
    );
  });

  it("logs and falls back to prompt when the decider throws", async () => {
    const autoDecide = vi.fn().mockRejectedValue(new Error("classifier boom"));
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      autoDecide,
      escalate: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" }),
    });

    const result = await runner.run(makeDescriptor(), null, "tc-err");

    expect(result).toEqual({ action: "allow" });
    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith(
      "auto_mode.unresolved",
      expect.objectContaining({
        reason: "decider_error",
        error: "classifier boom",
        toolName: "read",
      }),
    );
    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith(
      "auto_mode.fallback_to_prompt",
      expect.objectContaining({ reason: "decider_error", toolName: "read" }),
    );
    expect(deps.escalate).toHaveBeenCalledOnce();
  });

  it("tries auto-mode before prompting for ask-state bash pwd", async () => {
    const autoDecide = vi.fn().mockResolvedValue({
      approved: true,
      state: "approved",
      autoApproved: true,
    });
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      autoDecide,
    });

    const result = await runner.run(
      makeDescriptor({
        surface: "bash",
        input: { command: "pwd" },
        promptDetails: {
          source: "tool_call",
          agentName: null,
          message: "Allow bash?",
          toolCallId: "tc-pwd",
          toolName: "bash",
        },
        logContext: {
          source: "tool_call",
          toolCallId: "tc-pwd",
          toolName: "bash",
          command: "pwd",
        },
        decision: { surface: "bash", value: "pwd" },
      }),
      null,
      "tc-pwd",
    );

    expect(result).toEqual({ action: "allow" });
    expect(autoDecide).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { command: "pwd" },
        toolCallId: "tc-pwd",
        prompt: expect.objectContaining({ toolName: "bash" }),
      }),
    );
    expect(deps.escalate).not.toHaveBeenCalled();
  });

  it("logs when an ask-state gate has no auto decider", async () => {
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      escalate: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" }),
    });

    const result = await runner.run(
      makeDescriptor({
        surface: "bash",
        input: { command: "pwd" },
        promptDetails: {
          source: "tool_call",
          agentName: null,
          message: "Allow bash?",
          toolCallId: "tc-pwd",
          toolName: "bash",
        },
        logContext: {
          source: "tool_call",
          toolCallId: "tc-pwd",
          toolName: "bash",
          command: "pwd",
        },
        decision: { surface: "bash", value: "pwd" },
      }),
      null,
      "tc-pwd",
    );

    expect(result).toEqual({ action: "allow" });
    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith(
      "auto_mode.skipped",
      expect.objectContaining({
        reason: "missing_auto_decider",
        toolName: "bash",
        command: "pwd",
      }),
    );
    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith(
      "auto_mode.fallback_to_prompt",
      expect.objectContaining({
        reason: "missing_auto_decider",
        toolName: "bash",
        command: "pwd",
      }),
    );
    expect(deps.escalate).toHaveBeenCalledOnce();
  });

  it("skips auto-mode when deterministic metadata marks the ask as not classifier-approvable", async () => {
    const autoDecide = vi.fn().mockResolvedValue({
      approved: true,
      state: "approved",
      autoApproved: true,
    });
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      autoDecide,
      escalate: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" }),
    });

    const result = await runner.run(
      makeDescriptor({
        autoMode: {
          classifierApprovable: false,
          reason: "safety_floor_requires_human",
        },
      }),
      null,
      "tc-1",
    );

    expect(result).toEqual({ action: "allow" });
    expect(autoDecide).not.toHaveBeenCalled();
    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith(
      "auto_mode.skipped",
      expect.objectContaining({
        reason: "safety_floor_requires_human",
        classifierApprovable: false,
        toolName: "read",
      }),
    );
    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith(
      "auto_mode.fallback_to_prompt",
      expect.objectContaining({
        reason: "safety_floor_requires_human",
        toolName: "read",
      }),
    );
    expect(deps.escalate).toHaveBeenCalledOnce();
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "allow",
        resolution: "user_approved",
        reason: { kind: "manual_prompt" },
      }),
    );
  });

  it("does not call the decider for policy allow or deny", async () => {
    const autoDecide = vi.fn().mockResolvedValue(null);
    const allowRunner = makeGateRunner({ autoDecide });
    const denyRunner = makeGateRunner({
      autoDecide,
      resolveResult: makeCheckResult({ state: "deny", matchedPattern: "*" }),
    });

    await allowRunner.runner.run(makeDescriptor(), null, "tc-1");
    await denyRunner.runner.run(makeDescriptor(), null, "tc-2");

    expect(autoDecide).not.toHaveBeenCalled();
  });
});
