import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── logger stub ────────────────────────────────────────────────────────────
const { mockLoggerDebug, mockLoggerReview, mockCreateLogger } = vi.hoisted(
  () => ({
    mockLoggerDebug:
      vi.fn<
        (event: string, details?: Record<string, unknown>) => string | undefined
      >(),
    mockLoggerReview:
      vi.fn<
        (event: string, details?: Record<string, unknown>) => string | undefined
      >(),
    mockCreateLogger: vi.fn(),
  }),
);

vi.mock("../src/logging", () => ({
  createPermissionSystemLogger: mockCreateLogger,
}));

vi.mock("../src/permission-manager", () => ({
  PermissionManager: vi.fn(),
}));

vi.mock("../src/session-approval-cache", () => ({
  SessionApprovalCache: vi.fn(),
}));

import { getGlobalLogsDir } from "../src/config-paths";
import { DEFAULT_EXTENSION_CONFIG } from "../src/extension-config";
import { createExtensionRuntime } from "../src/runtime";

// ── test suite ─────────────────────────────────────────────────────────────

describe("createExtensionRuntime", () => {
  beforeEach(() => {
    mockLoggerDebug.mockReset();
    mockLoggerDebug.mockReturnValue(undefined);
    mockLoggerReview.mockReset();
    mockLoggerReview.mockReturnValue(undefined);
    mockCreateLogger.mockReset();
    mockCreateLogger.mockReturnValue({
      debug: mockLoggerDebug,
      review: mockLoggerReview,
    });
  });

  // ── Path derivation ──────────────────────────────────────────────────────

  it("sets agentDir from provided option", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.agentDir).toBe("/test/agent");
  });

  it("derives sessionsDir from agentDir", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.sessionsDir).toBe("/test/agent/sessions");
  });

  it("derives subagentSessionsDir from agentDir", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.subagentSessionsDir).toBe("/test/agent/subagent-sessions");
  });

  it("derives forwardingDir as sessions/permission-forwarding", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.forwardingDir).toBe(
      "/test/agent/sessions/permission-forwarding",
    );
  });

  it("derives globalLogsDir via getGlobalLogsDir", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.globalLogsDir).toBe(getGlobalLogsDir("/test/agent"));
  });

  // ── Default mutable state ────────────────────────────────────────────────

  it("initializes config to DEFAULT_EXTENSION_CONFIG", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.config).toEqual(DEFAULT_EXTENSION_CONFIG);
  });

  it("initializes runtimeContext to null", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.runtimeContext).toBeNull();
  });

  it("initializes activeSkillEntries to empty array", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.activeSkillEntries).toEqual([]);
  });

  it("initializes lastKnownActiveAgentName to null", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.lastKnownActiveAgentName).toBeNull();
  });

  it("initializes lastActiveToolsCacheKey to null", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.lastActiveToolsCacheKey).toBeNull();
  });

  it("initializes lastPromptStateCacheKey to null", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.lastPromptStateCacheKey).toBeNull();
  });

  it("initializes lastConfigWarning to null", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.lastConfigWarning).toBeNull();
  });

  it("initializes permissionForwardingContext to null", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.permissionForwardingContext).toBeNull();
  });

  it("initializes permissionForwardingTimer to null", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.permissionForwardingTimer).toBeNull();
  });

  it("initializes isProcessingForwardedRequests to false", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.isProcessingForwardedRequests).toBe(false);
  });

  it("creates a sessionApprovalCache instance", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.sessionApprovalCache).toBeDefined();
  });

  // ── Mutable state is writable ──────────────────────────────────────────

  it("allows config to be updated", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    const newConfig = {
      debugLog: true,
      permissionReviewLog: false,
      yoloMode: false,
    };
    runtime.config = newConfig;
    expect(runtime.config).toEqual(newConfig);
  });

  it("allows runtimeContext to be updated", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    const mockCtx = { hasUI: false } as never;
    runtime.runtimeContext = mockCtx;
    expect(runtime.runtimeContext).toBe(mockCtx);
  });

  // ── Logger is created with runtime-derived paths ─────────────────────────

  it("creates the logger with derived debugLogPath and reviewLogPath", () => {
    const agentDir = "/test/agent";
    const expectedLogsDir = getGlobalLogsDir(agentDir);
    createExtensionRuntime({ agentDir });
    expect(mockCreateLogger).toHaveBeenCalledOnce();
    const opts = mockCreateLogger.mock.calls[0][0] as {
      debugLogPath: string;
      reviewLogPath: string;
    };
    expect(opts.debugLogPath).toContain(expectedLogsDir);
    expect(opts.reviewLogPath).toContain(expectedLogsDir);
  });

  it("passes getConfig that reads current runtime.config", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    const opts = mockCreateLogger.mock.calls[0][0] as {
      getConfig: () => typeof DEFAULT_EXTENSION_CONFIG;
    };
    const updatedConfig = {
      debugLog: true,
      permissionReviewLog: false,
      yoloMode: false,
    };
    runtime.config = updatedConfig;
    // getConfig() should reflect the updated value
    expect(opts.getConfig()).toEqual(updatedConfig);
  });

  // ── writeDebugLog delegates to logger.debug ──────────────────────────────

  it("writeDebugLog calls logger.debug with event and details", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    runtime.writeDebugLog("test.event", { key: "value" });
    expect(mockLoggerDebug).toHaveBeenCalledWith("test.event", {
      key: "value",
    });
  });

  it("writeDebugLog uses empty object as default details", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    runtime.writeDebugLog("test.event");
    expect(mockLoggerDebug).toHaveBeenCalledWith("test.event", {});
  });

  // ── writeReviewLog delegates to logger.review ────────────────────────────

  it("writeReviewLog calls logger.review with event and details", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    runtime.writeReviewLog("test.event", { key: "value" });
    expect(mockLoggerReview).toHaveBeenCalledWith("test.event", {
      key: "value",
    });
  });

  it("writeReviewLog uses empty object as default details", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    runtime.writeReviewLog("test.event");
    expect(mockLoggerReview).toHaveBeenCalledWith("test.event", {});
  });

  // ── Logging warning reporter ──────────────────────────────────────────────

  it("notifies runtimeContext.ui when logger returns a warning", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    const mockNotify = vi.fn();
    runtime.runtimeContext = {
      hasUI: true,
      ui: { notify: mockNotify },
    } as never;
    mockLoggerDebug.mockReturnValueOnce("log dir not writable");
    runtime.writeDebugLog("some.event");
    expect(mockNotify).toHaveBeenCalledWith("log dir not writable", "warning");
  });

  it("does not notify when runtimeContext is null", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    mockLoggerDebug.mockReturnValueOnce("a warning");
    // runtimeContext is null, should not throw
    expect(() => runtime.writeDebugLog("some.event")).not.toThrow();
  });

  it("deduplicates logging warnings (same warning not reported twice)", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    const mockNotify = vi.fn();
    runtime.runtimeContext = {
      hasUI: true,
      ui: { notify: mockNotify },
    } as never;
    mockLoggerDebug
      .mockReturnValueOnce("duplicate warning")
      .mockReturnValueOnce("duplicate warning");
    runtime.writeDebugLog("event.one");
    runtime.writeDebugLog("event.two");
    // The same warning should only be notified once
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith("duplicate warning", "warning");
  });

  it("reports a different warning even after a duplicate has been suppressed", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    const mockNotify = vi.fn();
    runtime.runtimeContext = {
      hasUI: true,
      ui: { notify: mockNotify },
    } as never;
    mockLoggerDebug
      .mockReturnValueOnce("warning A")
      .mockReturnValueOnce("warning A")
      .mockReturnValueOnce("warning B");
    runtime.writeDebugLog("event.one");
    runtime.writeDebugLog("event.two");
    runtime.writeDebugLog("event.three");
    expect(mockNotify).toHaveBeenCalledTimes(2);
    expect(mockNotify).toHaveBeenNthCalledWith(1, "warning A", "warning");
    expect(mockNotify).toHaveBeenNthCalledWith(2, "warning B", "warning");
  });

  // ── Multiple independent runtimes ─────────────────────────────────────────

  it("two runtimes have independent state", () => {
    const rt1 = createExtensionRuntime({ agentDir: "/agent/a" });
    const rt2 = createExtensionRuntime({ agentDir: "/agent/b" });
    rt1.lastKnownActiveAgentName = "agent-a";
    expect(rt2.lastKnownActiveAgentName).toBeNull();
  });
});
