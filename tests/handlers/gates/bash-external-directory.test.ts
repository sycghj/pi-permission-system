import { describe, expect, it, vi } from "vitest";

import { evaluateBashExternalDirectoryGate } from "../../../src/handlers/gates/bash-external-directory";
import type {
  BashExternalDirectoryGateDeps,
  ToolCallContext,
} from "../../../src/handlers/gates/types";
import type { PermissionCheckResult } from "../../../src/types";

// ── helpers ─────────────��───────────────────────────────────────────���──────

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

function makeBashExtGateDeps(
  overrides: Partial<BashExternalDirectoryGateDeps> = {},
): BashExternalDirectoryGateDeps {
  return {
    checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
    getSessionRuleset: vi.fn().mockReturnValue([]),
    approveSessionRule: vi.fn(),
    writeReviewLog: vi.fn(),
    canConfirm: vi.fn().mockReturnValue(true),
    promptPermission: vi
      .fn()
      .mockResolvedValue({ approved: true, state: "approved" }),
    ...overrides,
  };
}

// ── tests ─────────────────────────────��───────────────────────────────���────

describe("evaluateBashExternalDirectoryGate", () => {
  it("returns null when tool is not bash", async () => {
    const tcc = makeTcc({ toolName: "read" });
    const result = await evaluateBashExternalDirectoryGate(
      tcc,
      makeBashExtGateDeps(),
    );
    expect(result).toBeNull();
  });

  it("returns null when no CWD", async () => {
    const tcc = makeTcc({ cwd: undefined });
    const result = await evaluateBashExternalDirectoryGate(
      tcc,
      makeBashExtGateDeps(),
    );
    expect(result).toBeNull();
  });

  it("returns null when command has no external paths", async () => {
    const tcc = makeTcc({ input: { command: "ls -la" } });
    const result = await evaluateBashExternalDirectoryGate(
      tcc,
      makeBashExtGateDeps(),
    );
    expect(result).toBeNull();
  });

  it("returns null and logs when all external paths are session-covered", async () => {
    const deps = makeBashExtGateDeps({
      checkPermission: vi
        .fn()
        .mockReturnValue(makeCheckResult("allow", { source: "session" })),
    });
    const tcc = makeTcc();
    const result = await evaluateBashExternalDirectoryGate(tcc, deps);
    expect(result).toBeNull();
    expect(deps.writeReviewLog).toHaveBeenCalledWith(
      "permission_request.session_approved",
      expect.objectContaining({ resolution: "session_approved" }),
    );
  });

  it("blocks when policy is deny", async () => {
    const deps = makeBashExtGateDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("deny")),
    });
    const tcc = makeTcc();
    const result = await evaluateBashExternalDirectoryGate(tcc, deps);
    expect(result).toMatchObject({ action: "block" });
  });

  it("allows without recording session rules when user approves once", async () => {
    const deps = makeBashExtGateDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" }),
    });
    const tcc = makeTcc();
    const result = await evaluateBashExternalDirectoryGate(tcc, deps);
    expect(result).toEqual({ action: "allow" });
    expect(deps.approveSessionRule).not.toHaveBeenCalled();
  });

  it("records one session rule per uncovered path on approved_for_session", async () => {
    const deps = makeBashExtGateDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
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
    expect(deps.approveSessionRule).toHaveBeenCalledTimes(2);
    for (const call of (deps.approveSessionRule as ReturnType<typeof vi.fn>)
      .mock.calls) {
      expect(call[0]).toBe("external_directory");
    }
  });

  it("blocks when user denies", async () => {
    const deps = makeBashExtGateDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: false, state: "denied" }),
    });
    const tcc = makeTcc();
    const result = await evaluateBashExternalDirectoryGate(tcc, deps);
    expect(result).toMatchObject({ action: "block" });
  });

  it("blocks when no UI available", async () => {
    const deps = makeBashExtGateDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
      canConfirm: vi.fn().mockReturnValue(false),
    });
    const tcc = makeTcc();
    const result = await evaluateBashExternalDirectoryGate(tcc, deps);
    expect(result).toMatchObject({ action: "block" });
  });

  it("only prompts about uncovered paths when some are session-covered", async () => {
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
    const deps = makeBashExtGateDeps({ checkPermission });
    const tcc = makeTcc({
      input: { command: "diff /outside/a.ts /outside/b.ts" },
    });
    const result = await evaluateBashExternalDirectoryGate(tcc, deps);
    expect(result).toEqual({ action: "allow" });
    // The prompt should have been called (for uncovered /outside/b.ts)
    expect(deps.promptPermission).toHaveBeenCalled();
  });
});
