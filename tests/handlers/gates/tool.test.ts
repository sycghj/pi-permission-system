import { describe, expect, it, vi } from "vitest";

import { evaluateToolGate } from "../../../src/handlers/gates/tool";
import type { ToolCallContext } from "../../../src/handlers/gates/types";
import type { HandlerDeps } from "../../../src/handlers/types";
import type { PermissionEventBus } from "../../../src/permission-events";
import type { PermissionCheckResult } from "../../../src/types";

// ── SDK stubs ──────────────────────────────────────────────────────────────
vi.mock("@mariozechner/pi-coding-agent", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@mariozechner/pi-coding-agent")>();
  return { ...original };
});

// ── helpers ────────────────────────────────────────────────────────────────

function makeTcc(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    toolName: "read",
    agentName: null,
    input: { path: "/test/project/foo.ts" },
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
    ...overrides,
  };
}

function makeEvents(): PermissionEventBus {
  return { emit: vi.fn(), on: vi.fn().mockReturnValue(() => undefined) };
}

function makeRuntime(
  overrides: Record<string, unknown> = {},
): HandlerDeps["runtime"] {
  return {
    config: { debugLog: false, permissionReviewLog: true, yoloMode: false },
    runtimeContext: {} as HandlerDeps["runtime"]["runtimeContext"],
    permissionManager: {
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("allow")),
    },
    sessionRules: {
      approve: vi.fn(),
      getRuleset: vi.fn().mockReturnValue([]),
      clear: vi.fn(),
    },
    writeReviewLog: vi.fn(),
    ...overrides,
  } as unknown as HandlerDeps["runtime"];
}

function makeDeps(overrides: Record<string, unknown> = {}): HandlerDeps {
  const { runtime: runtimeOverrides, events, ...rest } = overrides;
  return {
    runtime: makeRuntime(runtimeOverrides as Record<string, unknown>),
    events: events ?? makeEvents(),
    canRequestPermissionConfirmation: vi.fn().mockReturnValue(true),
    promptPermission: vi
      .fn()
      .mockResolvedValue({ approved: true, state: "approved" }),
    ...rest,
  } as unknown as HandlerDeps;
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("evaluateToolGate", () => {
  // ── Session-rule hit ─────────────────────────────────────────────────────

  it("allows and emits session_approved on session hit", async () => {
    const events = makeEvents();
    const deps = makeDeps({
      runtime: {
        permissionManager: {
          checkPermission: vi.fn().mockReturnValue(
            makeCheckResult("allow", {
              source: "session",
              toolName: "bash",
              command: "git status",
              matchedPattern: "git *",
            }),
          ),
        },
      },
      events,
    });
    const tcc = makeTcc({
      toolName: "bash",
      input: { command: "git status" },
    });
    const result = await evaluateToolGate(tcc, deps);
    expect(result).toEqual({ action: "allow" });
    expect(events.emit).toHaveBeenCalledWith(
      "permissions:decision",
      expect.objectContaining({
        surface: "bash",
        value: "git status",
        result: "allow",
        resolution: "session_approved",
        matchedPattern: "git *",
      }),
    );
  });

  it("does NOT record session rule on session hit", async () => {
    const sessionRules = {
      approve: vi.fn(),
      getRuleset: vi.fn().mockReturnValue([]),
      clear: vi.fn(),
    };
    const deps = makeDeps({
      runtime: {
        permissionManager: {
          checkPermission: vi.fn().mockReturnValue(
            makeCheckResult("allow", {
              source: "session",
              matchedPattern: "git *",
            }),
          ),
        },
        sessionRules,
      },
    });
    const tcc = makeTcc({
      toolName: "bash",
      input: { command: "git status" },
    });
    await evaluateToolGate(tcc, deps);
    expect(sessionRules.approve).not.toHaveBeenCalled();
  });

  // ── Policy allow ─────────────────────────────────────────────────────────

  it("allows and emits policy_allow", async () => {
    const events = makeEvents();
    const deps = makeDeps({ events });
    const tcc = makeTcc();
    const result = await evaluateToolGate(tcc, deps);
    expect(result).toEqual({ action: "allow" });
    expect(events.emit).toHaveBeenCalledWith(
      "permissions:decision",
      expect.objectContaining({
        result: "allow",
        resolution: "policy_allow",
      }),
    );
  });

  // ── Policy deny ──────────────────────────────────────────────────────────

  it("blocks and emits policy_deny", async () => {
    const events = makeEvents();
    const deps = makeDeps({
      runtime: {
        permissionManager: {
          checkPermission: vi.fn().mockReturnValue(makeCheckResult("deny")),
        },
      },
      events,
    });
    const tcc = makeTcc();
    const result = await evaluateToolGate(tcc, deps);
    expect(result).toMatchObject({ action: "block" });
    expect(events.emit).toHaveBeenCalledWith(
      "permissions:decision",
      expect.objectContaining({
        result: "deny",
        resolution: "policy_deny",
      }),
    );
  });

  // ── Policy ask — user approves once ──────────────────────────────────────

  it("allows and emits user_approved when user approves once", async () => {
    const events = makeEvents();
    const sessionRules = {
      approve: vi.fn(),
      getRuleset: vi.fn().mockReturnValue([]),
      clear: vi.fn(),
    };
    const deps = makeDeps({
      runtime: {
        permissionManager: {
          checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
        },
        sessionRules,
      },
      events,
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" }),
    });
    const tcc = makeTcc();
    const result = await evaluateToolGate(tcc, deps);
    expect(result).toEqual({ action: "allow" });
    expect(sessionRules.approve).not.toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      "permissions:decision",
      expect.objectContaining({
        result: "allow",
        resolution: "user_approved",
      }),
    );
  });

  // ── Policy ask — user approves for session ───────────────────────────────

  it("records session rule when user approves for session", async () => {
    const events = makeEvents();
    const sessionRules = {
      approve: vi.fn(),
      getRuleset: vi.fn().mockReturnValue([]),
      clear: vi.fn(),
    };
    const deps = makeDeps({
      runtime: {
        permissionManager: {
          checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
        },
        sessionRules,
      },
      events,
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved_for_session" }),
    });
    const tcc = makeTcc();
    const result = await evaluateToolGate(tcc, deps);
    expect(result).toEqual({ action: "allow" });
    expect(sessionRules.approve).toHaveBeenCalledWith("read", "*");
    expect(events.emit).toHaveBeenCalledWith(
      "permissions:decision",
      expect.objectContaining({
        resolution: "user_approved_for_session",
      }),
    );
  });

  // ── Policy ask — user denies ─────────────────────────────────────────────

  it("blocks and emits user_denied", async () => {
    const events = makeEvents();
    const deps = makeDeps({
      runtime: {
        permissionManager: {
          checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
        },
      },
      events,
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: false, state: "denied" }),
    });
    const tcc = makeTcc();
    const result = await evaluateToolGate(tcc, deps);
    expect(result).toMatchObject({ action: "block" });
    expect(events.emit).toHaveBeenCalledWith(
      "permissions:decision",
      expect.objectContaining({
        result: "deny",
        resolution: "user_denied",
      }),
    );
  });

  // ── Policy ask — no UI ───────────────────────────────────────────────────

  it("blocks and emits confirmation_unavailable when no UI", async () => {
    const events = makeEvents();
    const deps = makeDeps({
      runtime: {
        permissionManager: {
          checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
        },
      },
      events,
      canRequestPermissionConfirmation: vi.fn().mockReturnValue(false),
    });
    const tcc = makeTcc();
    const result = await evaluateToolGate(tcc, deps);
    expect(result).toMatchObject({ action: "block" });
    expect(events.emit).toHaveBeenCalledWith(
      "permissions:decision",
      expect.objectContaining({
        result: "deny",
        resolution: "confirmation_unavailable",
      }),
    );
  });

  // ── Auto-approved ────────────────────────────────────────────────────────

  it("emits auto_approved resolution when decision is auto-approved", async () => {
    const events = makeEvents();
    const deps = makeDeps({
      runtime: {
        permissionManager: {
          checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
        },
      },
      events,
      promptPermission: vi.fn().mockResolvedValue({
        approved: true,
        state: "approved",
        autoApproved: true,
      }),
    });
    const tcc = makeTcc();
    const result = await evaluateToolGate(tcc, deps);
    expect(result).toEqual({ action: "allow" });
    expect(events.emit).toHaveBeenCalledWith(
      "permissions:decision",
      expect.objectContaining({
        resolution: "auto_approved",
      }),
    );
  });

  // ── Bash-specific value ──────────────────────────────────────────────────

  it("uses command as decision value for bash tool", async () => {
    const events = makeEvents();
    const deps = makeDeps({
      runtime: {
        permissionManager: {
          checkPermission: vi.fn().mockReturnValue(
            makeCheckResult("allow", {
              toolName: "bash",
              command: "git status",
            }),
          ),
        },
      },
      events,
    });
    const tcc = makeTcc({
      toolName: "bash",
      input: { command: "git status" },
    });
    await evaluateToolGate(tcc, deps);
    expect(events.emit).toHaveBeenCalledWith(
      "permissions:decision",
      expect.objectContaining({
        surface: "bash",
        value: "git status",
      }),
    );
  });

  // ── MCP-specific value ───────────────────────────────────────────────────

  it("uses target as decision value for mcp tool", async () => {
    const events = makeEvents();
    const deps = makeDeps({
      runtime: {
        permissionManager: {
          checkPermission: vi.fn().mockReturnValue(
            makeCheckResult("allow", {
              toolName: "mcp",
              target: "exa:search",
            }),
          ),
        },
      },
      events,
    });
    const tcc = makeTcc({ toolName: "mcp", input: { tool: "exa:search" } });
    await evaluateToolGate(tcc, deps);
    expect(events.emit).toHaveBeenCalledWith(
      "permissions:decision",
      expect.objectContaining({
        surface: "mcp",
        value: "exa:search",
      }),
    );
  });

  // ── Bash unavailable message ─────────────────────────────────────────────

  it("includes command in unavailable message for bash", async () => {
    const deps = makeDeps({
      runtime: {
        permissionManager: {
          checkPermission: vi
            .fn()
            .mockReturnValue(
              makeCheckResult("ask", { toolName: "bash", command: "rm -rf /" }),
            ),
        },
      },
      canRequestPermissionConfirmation: vi.fn().mockReturnValue(false),
    });
    const tcc = makeTcc({
      toolName: "bash",
      input: { command: "rm -rf /" },
    });
    const result = await evaluateToolGate(tcc, deps);
    expect(result.action).toBe("block");
    if (result.action === "block") {
      expect(result.reason).toContain("rm -rf /");
    }
  });
});
