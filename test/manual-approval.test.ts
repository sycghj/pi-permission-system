import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EXTENSION_CONFIG } from "#src/extension-config";
import { ManualApprovalService } from "#src/manual-approval";
import { ManualApprovalStore } from "#src/manual-approval-store";
import type { ToolRegistry } from "#src/tool-registry";
import { makeCtx } from "#test/helpers/handler-fixtures";

function makeService(options?: {
  floor?: "allow" | "block";
  automatic?: "allow" | "deny" | "review";
  approved?: boolean;
  useAutoMode?: boolean;
}) {
  const store = new ManualApprovalStore({ now: () => 1_000 });
  const denyFloor = {
    evaluateDenyFloor: vi
      .fn()
      .mockResolvedValue(
        options?.floor === "block"
          ? { action: "block", reason: "policy denied" }
          : { action: "allow" },
      ),
  };
  const automatic = {
    evaluateAutomatic: vi.fn().mockResolvedValue(
      options?.automatic === "allow"
        ? { action: "allow" }
        : options?.automatic === "deny"
          ? { action: "block", reason: "automatic policy denied" }
          : {
              action: "block",
              reason: "automatic review required",
              manualReviewRequired: true,
            },
    ),
  };
  const escalator = {
    escalate: vi.fn(),
    escalateHumanOnly: vi.fn().mockResolvedValue({
      approved: options?.approved !== false,
      state: options?.approved === false ? "denied" : "approved",
    }),
  };
  const toolRegistry: ToolRegistry = {
    getAll: vi.fn().mockReturnValue([{ name: "edit" }, { name: "bash" }]),
    getActive: vi.fn().mockReturnValue([]),
    setActive: vi.fn(),
  };
  const logger = { review: vi.fn() };
  const service = new ManualApprovalService({
    store,
    denyFloor,
    automatic,
    escalator,
    toolRegistry,
    getConfig: () => ({
      ...DEFAULT_EXTENSION_CONFIG,
      manualApproval: {
        enabled: true,
        useAutoMode: options?.useAutoMode ?? true,
      },
    }),
    resolveAgentName: () => "builder",
    logger,
  });
  return { service, store, denyFloor, automatic, escalator, logger };
}

const editRequest = {
  toolName: "edit",
  input: { path: "a.ts", edits: [] },
  reason: "required migration",
};

describe("ManualApprovalService", () => {
  it("runs a proactive request through automatic authorization before prompting", async () => {
    const { service, automatic, escalator } = makeService();

    const result = await service.request("request-1", editRequest, makeCtx());

    expect(automatic.evaluateAutomatic).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "edit",
        input: editRequest.input,
      }),
      { useAutoMode: true },
    );
    expect(escalator.escalateHumanOnly).toHaveBeenCalledOnce();
    expect(result.approved).toBe(true);
  });

  it("can skip Auto Mode while retaining the automatic authority preflight", async () => {
    const { service, automatic, escalator } = makeService({
      useAutoMode: false,
    });

    await service.request("request-1", editRequest, makeCtx());

    expect(automatic.evaluateAutomatic).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "edit" }),
      { useAutoMode: false },
    );
    expect(escalator.escalateHumanOnly).toHaveBeenCalledOnce();
  });

  it("issues an exact grant without a dialog when automatic authorization allows", async () => {
    const { service, escalator } = makeService({ automatic: "allow" });
    const ctx = makeCtx();

    const result = await service.request("request-1", editRequest, ctx);

    expect(result.approved).toBe(true);
    expect(result.message).toContain("Automatically approved");
    expect(escalator.escalateHumanOnly).not.toHaveBeenCalled();
    await expect(
      service.authorizeIfGranted(
        {
          toolName: "edit",
          input: { edits: [], path: "a.ts" },
          agentName: "builder",
          toolCallId: "target-1",
          cwd: ctx.cwd,
        },
        ctx.sessionManager.getSessionId(),
        "assistant-2",
      ),
    ).resolves.toEqual({ action: "allow" });
  });

  it("refuses a deterministic deny without automatic or human authorization", async () => {
    const { service, automatic, escalator } = makeService({ floor: "block" });

    const result = await service.request(
      "request-1",
      { toolName: "bash", input: { command: "rm -rf x" }, reason: "cleanup" },
      makeCtx(),
    );

    expect(result.approved).toBe(false);
    expect(result.message).toContain("cannot override policy deny");
    expect(automatic.evaluateAutomatic).not.toHaveBeenCalled();
    expect(escalator.escalateHumanOnly).not.toHaveBeenCalled();
  });

  it("refuses an automatic deterministic deny without prompting", async () => {
    const { service, escalator } = makeService({ automatic: "deny" });

    const result = await service.request("request-1", editRequest, makeCtx());

    expect(result.approved).toBe(false);
    expect(result.message).toContain("automatic policy denied");
    expect(escalator.escalateHumanOnly).not.toHaveBeenCalled();
  });

  it("blocks a matching target while its request tool call is still pending", async () => {
    const { service } = makeService({ automatic: "allow" });
    const ctx = makeCtx();
    service.noteRequest(
      editRequest,
      "builder",
      ctx.sessionManager.getSessionId(),
      "assistant-1",
    );
    await service.request("request-1", editRequest, ctx);

    const target = {
      toolName: "edit",
      input: editRequest.input,
      agentName: "builder",
      toolCallId: "same-batch-target",
      cwd: ctx.cwd,
    } as const;
    await expect(
      service.authorizeIfGranted(
        target,
        ctx.sessionManager.getSessionId(),
        "assistant-1",
      ),
    ).resolves.toMatchObject({
      action: "block",
      reason: expect.stringContaining("next model step"),
    });
    await expect(
      service.authorizeIfGranted(
        target,
        ctx.sessionManager.getSessionId(),
        "assistant-2",
      ),
    ).resolves.toEqual({ action: "allow" });
  });

  it("issues one exact grant after direct human approval", async () => {
    const { service, escalator } = makeService();
    const ctx = makeCtx();

    const result = await service.request("request-1", editRequest, ctx);

    expect(result.approved).toBe(true);
    expect(result.message).toContain("next model step");
    expect(result.message).toContain("Continue autonomously");
    expect(result.message).toContain("do not ask the user to reply");
    expect(result.message).not.toContain("next turn");
    expect(escalator.escalateHumanOnly).toHaveBeenCalledWith(
      expect.objectContaining({
        humanOnly: true,
        toolName: "edit",
      }),
    );
    await expect(
      service.authorizeIfGranted(
        {
          toolName: "edit",
          input: { edits: [], path: "a.ts" },
          agentName: "builder",
          toolCallId: "target-1",
          cwd: ctx.cwd,
        },
        ctx.sessionManager.getSessionId(),
        "assistant-2",
      ),
    ).resolves.toEqual({ action: "allow" });
    await expect(
      service.authorizeIfGranted(
        {
          toolName: "edit",
          input: { edits: [], path: "a.ts" },
          agentName: "builder",
          toolCallId: "target-2",
          cwd: ctx.cwd,
        },
        ctx.sessionManager.getSessionId(),
        "assistant-3",
      ),
    ).resolves.toBeNull();
  });

  it("rechecks the deny floor when consuming and consumes a blocked grant", async () => {
    const { service, denyFloor } = makeService({ automatic: "allow" });
    const ctx = makeCtx();
    const request = {
      toolName: "bash",
      input: { command: "danger" },
      reason: "needed",
    };
    await service.request("request-1", request, ctx);
    denyFloor.evaluateDenyFloor.mockResolvedValue({
      action: "block",
      reason: "policy changed",
    });
    const invocation = {
      toolName: "bash",
      input: request.input,
      agentName: "builder",
      toolCallId: "target-1",
      cwd: ctx.cwd,
    } as const;

    await expect(
      service.authorizeIfGranted(
        invocation,
        ctx.sessionManager.getSessionId(),
        "assistant-2",
      ),
    ).resolves.toEqual({ action: "block", reason: "policy changed" });
    await expect(
      service.authorizeIfGranted(
        invocation,
        ctx.sessionManager.getSessionId(),
        "assistant-3",
      ),
    ).resolves.toBeNull();
  });

  it("reruns automatic authorization for changed input and repeated requests", async () => {
    const { service, automatic, escalator } = makeService({ approved: false });
    const ctx = makeCtx();

    await service.request(
      "request-1",
      {
        toolName: "bash",
        input: { command: "deploy --dry-run" },
        reason: "release",
      },
      ctx,
    );
    await service.request(
      "request-2",
      {
        toolName: "bash",
        input: { command: "deploy --force" },
        reason: "release",
      },
      ctx,
    );
    await service.request(
      "request-3",
      {
        toolName: "bash",
        input: { command: "deploy --force" },
        reason: "release retry",
      },
      ctx,
    );

    expect(automatic.evaluateAutomatic).toHaveBeenCalledTimes(3);
    expect(escalator.escalateHumanOnly).toHaveBeenCalledTimes(3);
  });
});
