import { describe, expect, it, vi } from "vitest";
import { describeBashExternalDirectoryGate } from "../../../src/handlers/gates/bash-external-directory";
import type {
  GateBypass,
  GateDescriptor,
} from "../../../src/handlers/gates/descriptor";
import {
  isGateBypass,
  isGateDescriptor,
} from "../../../src/handlers/gates/descriptor";
import type { ToolCallContext } from "../../../src/handlers/gates/types";
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

// ── tests ──────────────────────────────────────────────────────────────────

describe("describeBashExternalDirectoryGate", () => {
  it("returns null when tool is not bash", async () => {
    const result = await describeBashExternalDirectoryGate(
      makeTcc({ toolName: "read" }),
      vi.fn().mockReturnValue(makeCheckResult("ask")),
      vi.fn().mockReturnValue([]),
    );
    expect(result).toBeNull();
  });

  it("returns null when no CWD", async () => {
    const result = await describeBashExternalDirectoryGate(
      makeTcc({ cwd: undefined }),
      vi.fn().mockReturnValue(makeCheckResult("ask")),
      vi.fn().mockReturnValue([]),
    );
    expect(result).toBeNull();
  });

  it("returns null when command has no external paths", async () => {
    const result = await describeBashExternalDirectoryGate(
      makeTcc({ input: { command: "ls -la" } }),
      vi.fn().mockReturnValue(makeCheckResult("ask")),
      vi.fn().mockReturnValue([]),
    );
    expect(result).toBeNull();
  });

  it("returns GateBypass when all external paths are session-covered", async () => {
    const checkPermission = vi
      .fn()
      .mockReturnValue(makeCheckResult("allow", { source: "session" }));
    const result = await describeBashExternalDirectoryGate(
      makeTcc(),
      checkPermission,
      vi.fn().mockReturnValue([]),
    );
    expect(result).not.toBeNull();
    expect(isGateBypass(result)).toBe(true);
    const bypass = result as GateBypass;
    expect(bypass.action).toBe("allow");
    expect(bypass.log).toMatchObject({
      event: "permission_request.session_approved",
      details: expect.objectContaining({ resolution: "session_approved" }),
    });
  });

  it("returns GateDescriptor with multi-pattern sessionApproval for uncovered paths", async () => {
    const checkPermission = vi.fn().mockReturnValue(makeCheckResult("ask"));
    const result = await describeBashExternalDirectoryGate(
      makeTcc({ input: { command: "diff /outside/a.ts /outside/b.ts" } }),
      checkPermission,
      vi.fn().mockReturnValue([]),
    );
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.sessionApproval).toBeDefined();
    expect(desc.sessionApproval).toHaveProperty("patterns");
    const patterns = (desc.sessionApproval as { patterns: string[] }).patterns;
    expect(patterns.length).toBeGreaterThan(0);
  });

  it("uses config-level checkPermission for the policy state", async () => {
    const checkPermission = vi
      .fn()
      .mockImplementation((surface: string, input: Record<string, unknown>) => {
        // Path-specific check returns session for coverage filtering
        if (input.path) return makeCheckResult("allow", { source: "special" });
        // Config-level check (no path) returns deny
        return makeCheckResult("deny");
      });
    const result = await describeBashExternalDirectoryGate(
      makeTcc(),
      checkPermission,
      vi.fn().mockReturnValue([]),
    );
    expect(isGateDescriptor(result)).toBe(true);
    // The descriptor should carry the deny state from the config-level check
    // (it will be checked as preCheck by the runner)
    const desc = result as GateDescriptor;
    expect(desc.preCheck?.state).toBe("deny");
  });

  it("descriptor surface is 'external_directory'", async () => {
    const result = await describeBashExternalDirectoryGate(
      makeTcc(),
      vi.fn().mockReturnValue(makeCheckResult("ask")),
      vi.fn().mockReturnValue([]),
    );
    const desc = result as GateDescriptor;
    expect(desc.surface).toBe("external_directory");
  });

  it("descriptor decision surface is 'external_directory'", async () => {
    const result = await describeBashExternalDirectoryGate(
      makeTcc(),
      vi.fn().mockReturnValue(makeCheckResult("ask")),
      vi.fn().mockReturnValue([]),
    );
    const desc = result as GateDescriptor;
    expect(desc.decision.surface).toBe("external_directory");
  });

  it("messages contain the command", async () => {
    const result = await describeBashExternalDirectoryGate(
      makeTcc({ input: { command: "cat /outside/file.ts" } }),
      vi.fn().mockReturnValue(makeCheckResult("ask")),
      vi.fn().mockReturnValue([]),
    );
    const desc = result as GateDescriptor;
    expect(desc.messages.denyReason).toContain("cat /outside/file.ts");
    expect(desc.messages.unavailableReason).toContain("cat /outside/file.ts");
  });

  it("promptDetails includes command and tool_call source", async () => {
    const result = await describeBashExternalDirectoryGate(
      makeTcc({ agentName: "agent-1", toolCallId: "tc-5" }),
      vi.fn().mockReturnValue(makeCheckResult("ask")),
      vi.fn().mockReturnValue([]),
    );
    const desc = result as GateDescriptor;
    expect(desc.promptDetails).toMatchObject({
      source: "tool_call",
      agentName: "agent-1",
      toolCallId: "tc-5",
      toolName: "bash",
      command: "cat /outside/project/file.ts",
    });
  });

  it("only includes uncovered paths when some are session-covered", async () => {
    const checkPermission = vi
      .fn()
      .mockImplementation((surface: string, input: Record<string, unknown>) => {
        if (input.path === "/outside/a.ts") {
          return makeCheckResult("allow", { source: "session" });
        }
        return makeCheckResult("ask");
      });
    const result = await describeBashExternalDirectoryGate(
      makeTcc({ input: { command: "diff /outside/a.ts /outside/b.ts" } }),
      checkPermission,
      vi.fn().mockReturnValue([]),
    );
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    // Should have patterns only for the uncovered path
    const patterns = (desc.sessionApproval as { patterns: string[] }).patterns;
    expect(patterns.length).toBe(1);
  });
});
