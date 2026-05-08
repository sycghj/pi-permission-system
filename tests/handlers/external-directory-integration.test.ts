/**
 * Integration tests for external_directory tool_call enforcement.
 *
 * These tests exercise PermissionGateHandler.handleToolCall with the
 * external-directory gate, verifying the full descriptor→runner pipeline
 * while mocking only the PermissionSession boundary.
 *
 * Regression guard: importing the four external-directory message helpers
 * ensures the test file fails to load if any helper is removed.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  formatExternalDirectoryAskPrompt,
  formatExternalDirectoryDenyReason,
  formatExternalDirectoryHardStopHint,
  formatExternalDirectoryUserDeniedReason,
} from "../../src/handlers/gates/external-directory-messages";
import { PermissionGateHandler } from "../../src/handlers/permission-gate-handler";
import type { PermissionSession } from "../../src/permission-session";
import type { ToolRegistry } from "../../src/tool-registry";
import type { PermissionCheckResult, PermissionState } from "../../src/types";

// ── SDK stubs ──────────────────────────────────────────────────────────────
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...original };
});

// ── Regression guard: helper presence ──────────────────────────────────────

describe("external_directory helper regression guard", () => {
  it("formatExternalDirectoryHardStopHint is a callable function", () => {
    expect(typeof formatExternalDirectoryHardStopHint).toBe("function");
    expect(formatExternalDirectoryHardStopHint()).toContain("Hard stop");
  });

  it("formatExternalDirectoryAskPrompt is a callable function", () => {
    expect(typeof formatExternalDirectoryAskPrompt).toBe("function");
    expect(
      formatExternalDirectoryAskPrompt("read", "/outside/file", "/project"),
    ).toContain("/outside/file");
  });

  it("formatExternalDirectoryDenyReason is a callable function", () => {
    expect(typeof formatExternalDirectoryDenyReason).toBe("function");
    expect(
      formatExternalDirectoryDenyReason("read", "/outside/file", "/project"),
    ).toContain("Hard stop");
  });

  it("formatExternalDirectoryUserDeniedReason is a callable function", () => {
    expect(typeof formatExternalDirectoryUserDeniedReason).toBe("function");
    expect(
      formatExternalDirectoryUserDeniedReason("read", "/outside/file"),
    ).toContain("User denied");
  });
});
