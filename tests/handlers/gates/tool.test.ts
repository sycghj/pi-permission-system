import { describe, expect, it, vi } from "vitest";

import { evaluateToolGate } from "../../../src/handlers/gates/tool";
import type {
  ToolCallContext,
  ToolGateDeps,
} from "../../../src/handlers/gates/types";
import type { PermissionCheckResult } from "../../../src/types";

// ── helpers ────────────────────────────────────────────────────────────────

function makeTcc(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    toolName: "read",
    agentName: null,
    input: {},
    toolCallId: "tc-1",
    cwd: "/test/project",
    ...overrides,
  };
}

function makeCheckResult(
  state: "allow" | "deny" | "ask",
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    state,
    toolName: "read",
    source: "tool",
    origin: "builtin",
    matchedPattern: "*",
    ...overrides,
  };
}

function makeToolGateDeps(overrides: Partial<ToolGateDeps> = {}): ToolGateDeps {
  return {
    checkPermission: vi.fn().mockReturnValue(makeCheckResult("allow")),
    getSessionRuleset: vi.fn().mockReturnValue([]),
    approveSessionRule: vi.fn(),
    writeReviewLog: vi.fn(),
    emitDecision: vi.fn(),
    canConfirm: vi.fn().mockReturnValue(true),
    promptPermission: vi
      .fn()
      .mockResolvedValue({ approved: true, state: "approved" }),
    ...overrides,
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("evaluateToolGate", () => {
  it("allows when policy is allow", async () => {
    const deps = makeToolGateDeps();
    const result = await evaluateToolGate(makeTcc(), deps);
    expect(result).toEqual({ action: "allow" });
  });

  it("blocks when policy is deny", async () => {
    const deps = makeToolGateDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("deny")),
    });
    const result = await evaluateToolGate(makeTcc(), deps);
    expect(result).toMatchObject({ action: "block" });
  });

  it("allows on session-approved fast path", async () => {
    const deps = makeToolGateDeps({
      checkPermission: vi.fn().mockReturnValue(
        makeCheckResult("allow", {
          source: "session",
          matchedPattern: "git *",
        }),
      ),
    });
    const result = await evaluateToolGate(
      makeTcc({ toolName: "bash", input: { command: "git status" } }),
      deps,
    );
    expect(result).toEqual({ action: "allow" });
    expect(deps.writeReviewLog).toHaveBeenCalledWith(
      "permission_request.session_approved",
      expect.objectContaining({ resolution: "session_approved" }),
    );
    expect(deps.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: "session_approved" }),
    );
  });

  it("blocks when state is ask but canConfirm is false", async () => {
    const deps = makeToolGateDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
      canConfirm: vi.fn().mockReturnValue(false),
    });
    const result = await evaluateToolGate(makeTcc(), deps);
    expect(result).toMatchObject({ action: "block" });
  });

  it("allows when state is ask and user approves", async () => {
    const deps = makeToolGateDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" }),
    });
    const result = await evaluateToolGate(makeTcc(), deps);
    expect(result).toEqual({ action: "allow" });
  });

  it("blocks when state is ask and user denies", async () => {
    const deps = makeToolGateDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: false, state: "denied" }),
    });
    const result = await evaluateToolGate(makeTcc(), deps);
    expect(result).toMatchObject({ action: "block" });
  });

  it("approves session rule when user approves for session", async () => {
    const deps = makeToolGateDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved_for_session" }),
    });
    await evaluateToolGate(makeTcc(), deps);
    expect(deps.approveSessionRule).toHaveBeenCalled();
  });

  it("emits decision event with correct surface and result", async () => {
    const deps = makeToolGateDeps({
      checkPermission: vi
        .fn()
        .mockReturnValue(
          makeCheckResult("allow", { origin: "global", matchedPattern: "*" }),
        ),
    });
    await evaluateToolGate(makeTcc({ toolName: "write" }), deps);
    expect(deps.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "write",
        result: "allow",
        resolution: "policy_allow",
        origin: "global",
      }),
    );
  });

  it("passes session ruleset to checkPermission", async () => {
    const sessionRules = [
      {
        surface: "bash",
        pattern: "git *",
        action: "allow" as const,
        origin: "session" as const,
      },
    ];
    const deps = makeToolGateDeps({
      getSessionRuleset: vi.fn().mockReturnValue(sessionRules),
    });
    await evaluateToolGate(makeTcc({ toolName: "bash" }), deps);
    expect(deps.checkPermission).toHaveBeenCalledWith(
      "bash",
      expect.anything(),
      undefined,
      sessionRules,
    );
  });
});
