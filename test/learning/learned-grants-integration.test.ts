import { describe, expect, it, vi } from "vitest";

import { BashProgram } from "#src/access-intent/bash/program";
import { GateRunner } from "#src/handlers/gates/runner";
import { ToolCallGatePipeline } from "#src/handlers/gates/tool-call-gate-pipeline";
import { extractBashCapability } from "#src/learning/bash-capability-extractor";
import { LearnedGrantEvaluator } from "#src/learning/learned-grant-evaluator";
import { SessionLearningStore } from "#src/learning/session-learning-store";
import { posixPathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path-normalizer";
import { makeReporter, makeTcc } from "#test/helpers/gate-fixtures";
import { makeCheckResult } from "#test/helpers/handler-fixtures";

type RunnerCtor = new (...args: unknown[]) => GateRunner;

const normalizer = new PathNormalizer(posixPathFlavor, "/repo/app");

function makeInputs() {
  return {
    getActiveSkillEntries: () => [],
    getInfrastructureReadDirs: () => [],
    getToolPreviewLimits: () => ({
      toolInputPreviewMaxLength: 200,
      toolTextSummaryMaxLength: 80,
      toolInputLogPreviewMaxLength: 200,
    }),
    getPathNormalizer: () => normalizer,
    getShellToolAliases: () => undefined,
    getPromotablePathTokenMatcher: () => () => false,
  };
}

function makeRunner(learned: unknown, autoDecide = vi.fn()) {
  const resolve = vi
    .fn()
    .mockReturnValue(makeCheckResult({ state: "ask", matchedPattern: "*" }));
  return {
    runner: new (GateRunner as unknown as RunnerCtor)(
      { resolve },
      { recordSessionApproval: vi.fn() },
      { escalate: vi.fn() },
      makeReporter(),
      { decide: autoDecide },
      learned,
    ),
    resolve,
  };
}

describe("learned grants pipeline integration", () => {
  it("lets a learned bash grant avoid auto-mode and prompt", async () => {
    const learned = {
      evaluateAsk: vi.fn().mockReturnValue({
        action: "allow",
        grantId: "lg-1",
        reservationId: "r-1",
      }),
    };
    const autoDecide = vi.fn().mockResolvedValue({
      approved: true,
      state: "approved",
      autoApproved: true,
    });
    const { runner, resolve } = makeRunner(learned, autoDecide);
    const pipeline = new ToolCallGatePipeline({ resolve }, makeInputs());

    await expect(
      pipeline.evaluate(
        makeTcc({ input: { command: "pwd" }, cwd: "/repo/app" }),
        runner,
      ),
    ).resolves.toEqual({ action: "allow" });

    expect(learned.evaluateAsk).toHaveBeenCalled();
    expect(autoDecide).not.toHaveBeenCalled();
  });

  it("matches a real store grant using the extracted capability fingerprint", async () => {
    const program = await BashProgram.parse("pwd", normalizer);
    const capability = extractBashCapability({
      program,
      cwd: "/repo/app",
      source: "tool_call",
      agentName: "agent-1",
      projectIdentity: { kind: "git-common-dir", id: "git:/repo/app/.git" },
    });
    const store = new SessionLearningStore({ now: () => 1_000 });
    store.createGrant({
      id: "lg-real",
      status: "active",
      matcher: { kind: "exact", intentFingerprint: capability.fingerprint },
      scope: { sources: ["tool_call"], agents: ["agent-1"] },
      coveredGateSurfaces: ["bash"],
      expiresAt: 1_100,
      maxUses: 1,
      committedUses: 0,
      reservedUses: 0,
    });
    const autoDecide = vi.fn().mockResolvedValue({ approved: true });
    const { runner, resolve } = makeRunner(
      new LearnedGrantEvaluator(store),
      autoDecide,
    );
    const pipeline = new ToolCallGatePipeline({ resolve }, makeInputs());

    await expect(
      pipeline.evaluate(
        makeTcc({
          agentName: "agent-1",
          input: { command: "pwd" },
          cwd: "/repo/app",
        }),
        runner,
      ),
    ).resolves.toEqual({ action: "allow" });

    expect(autoDecide).not.toHaveBeenCalled();
    expect(store.explain(capability.fingerprint)).toMatchObject({
      matched: false,
      reason: "use-limit-exhausted",
    });
  });
});
