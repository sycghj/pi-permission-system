import { describe, expect, it, vi } from "vitest";

import { evaluateBashExternalDirectoryGate } from "../../../src/handlers/gates/bash-external-directory";
import type { ToolCallContext } from "../../../src/handlers/gates/types";
import type { HandlerDeps } from "../../../src/handlers/types";
import type { PermissionEventBus } from "../../../src/permission-events";
import type { PermissionCheckResult } from "../../../src/types";

// ── helpers ────────────────────────────────────────────────────────────────

function makeTcc(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    toolName: "bash",
    agentName: null,
    input: { command: "cat /outside/project/file.ts" },
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
    toolName: "external_directory",
    source: "special",
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
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
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

describe("evaluateBashExternalDirectoryGate", () => {
  it("returns null when tool is not bash", async () => {
    const tcc = makeTcc({ toolName: "read" });
    const result = await evaluateBashExternalDirectoryGate(tcc, makeDeps());
    expect(result).toBeNull();
  });

  it("returns null when no CWD", async () => {
    const tcc = makeTcc({ cwd: undefined });
    const result = await evaluateBashExternalDirectoryGate(tcc, makeDeps());
    expect(result).toBeNull();
  });

  it("returns null when command has no external paths", async () => {
    const tcc = makeTcc({ input: { command: "ls -la" } });
    const result = await evaluateBashExternalDirectoryGate(tcc, makeDeps());
    expect(result).toBeNull();
  });

  it("returns null and logs when all external paths are session-covered", async () => {
    const writeReviewLog = vi.fn();
    const deps = makeDeps({
      runtime: {
        permissionManager: {
          checkPermission: vi
            .fn()
            .mockReturnValue(makeCheckResult("allow", { source: "session" })),
        },
        writeReviewLog,
      },
    });
    const tcc = makeTcc();
    const result = await evaluateBashExternalDirectoryGate(tcc, deps);
    expect(result).toBeNull();
    expect(writeReviewLog).toHaveBeenCalledWith(
      "permission_request.session_approved",
      expect.objectContaining({ resolution: "session_approved" }),
    );
  });

  it("blocks when policy is deny", async () => {
    const deps = makeDeps({
      runtime: {
        permissionManager: {
          checkPermission: vi.fn().mockReturnValue(makeCheckResult("deny")),
        },
      },
    });
    const tcc = makeTcc();
    const result = await evaluateBashExternalDirectoryGate(tcc, deps);
    expect(result).toMatchObject({ action: "block" });
  });

  it("allows without recording session rules when user approves once", async () => {
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
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" }),
    });
    const tcc = makeTcc();
    const result = await evaluateBashExternalDirectoryGate(tcc, deps);
    expect(result).toEqual({ action: "allow" });
    expect(sessionRules.approve).not.toHaveBeenCalled();
  });

  it("records one session rule per uncovered path on approved_for_session", async () => {
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
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved_for_session" }),
    });
    // Command referencing two external paths
    const tcc = makeTcc({
      input: {
        command: "diff /outside/a.ts /outside/b.ts",
      },
    });
    const result = await evaluateBashExternalDirectoryGate(tcc, deps);
    expect(result).toEqual({ action: "allow" });
    // Each uncovered path gets its own session rule
    expect(sessionRules.approve).toHaveBeenCalledTimes(2);
    for (const call of (sessionRules.approve as ReturnType<typeof vi.fn>).mock
      .calls) {
      expect(call[0]).toBe("external_directory");
    }
  });

  it("blocks when user denies", async () => {
    const deps = makeDeps({
      runtime: {
        permissionManager: {
          checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
        },
      },
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: false, state: "denied" }),
    });
    const tcc = makeTcc();
    const result = await evaluateBashExternalDirectoryGate(tcc, deps);
    expect(result).toMatchObject({ action: "block" });
  });

  it("blocks when no UI available", async () => {
    const deps = makeDeps({
      runtime: {
        permissionManager: {
          checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
        },
      },
      canRequestPermissionConfirmation: vi.fn().mockReturnValue(false),
    });
    const tcc = makeTcc();
    const result = await evaluateBashExternalDirectoryGate(tcc, deps);
    expect(result).toMatchObject({ action: "block" });
  });

  it("only prompts about uncovered paths when some are session-covered", async () => {
    // First call (for getRuleset path filter): session covers /outside/a.ts
    // Second call (for config-level policy): returns ask
    const checkPermission = vi
      .fn()
      .mockImplementation(
        (
          surface: string,
          input: Record<string, unknown>,
        ): PermissionCheckResult => {
          if (
            surface === "external_directory" &&
            input.path === "/outside/a.ts"
          ) {
            return makeCheckResult("allow", { source: "session" });
          }
          return makeCheckResult("ask");
        },
      );
    const deps = makeDeps({
      runtime: {
        permissionManager: { checkPermission },
      },
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" }),
    });
    const tcc = makeTcc({
      input: { command: "diff /outside/a.ts /outside/b.ts" },
    });
    const result = await evaluateBashExternalDirectoryGate(tcc, deps);
    expect(result).toEqual({ action: "allow" });
    // The prompt should have been called (for uncovered /outside/b.ts)
    expect(deps.promptPermission).toHaveBeenCalled();
  });
});
