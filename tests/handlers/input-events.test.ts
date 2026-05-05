/**
 * Tests that handleInput emits permissions:decision events for skill input gates.
 */
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { handleInput } from "../../src/handlers/input";
import type { HandlerDeps } from "../../src/handlers/types";
import type { PermissionDecisionEvent } from "../../src/permission-events";
import { PERMISSIONS_DECISION_CHANNEL } from "../../src/permission-events";
import type { ExtensionRuntime } from "../../src/runtime";

// ── helpers ────────────────────────────────────────────────────────────────

function makeEvents() {
  return {
    emit: vi.fn(),
    on: vi.fn().mockReturnValue(() => undefined),
  };
}

function makeCtx(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  return {
    cwd: "/test/project",
    hasUI: true,
    ui: {
      setStatus: vi.fn(),
      notify: vi.fn(),
      select: vi.fn(),
      input: vi.fn(),
    },
    sessionManager: {
      getEntries: vi.fn().mockReturnValue([]),
      getSessionDir: vi.fn().mockReturnValue("/sessions/test"),
      addEntry: vi.fn(),
    },
    ...overrides,
  } as unknown as ExtensionContext;
}

function makeRuntime(
  state: "allow" | "deny" | "ask" = "allow",
): ExtensionRuntime {
  return {
    agentDir: "/test/agent",
    sessionsDir: "/test/agent/sessions",
    subagentSessionsDir: "/test/agent/subagent-sessions",
    forwardingDir: "/test/agent/sessions/permission-forwarding",
    globalLogsDir: "/test/agent/extensions/pi-permission-system/logs",
    piInfrastructureDirs: ["/test/agent"],
    config: { debugLog: false, permissionReviewLog: true, yoloMode: false },
    runtimeContext: null,
    permissionManager: {
      checkPermission: vi.fn().mockReturnValue({
        state,
        toolName: "skill",
        source: "skill",
        origin: "global",
        matchedPattern: "*",
      }),
    } as unknown as ExtensionRuntime["permissionManager"],
    activeSkillEntries: [],
    lastKnownActiveAgentName: null,
    lastActiveToolsCacheKey: null,
    lastPromptStateCacheKey: null,
    lastConfigWarning: null,
    sessionRules: {
      approve: vi.fn(),
      getRuleset: vi.fn().mockReturnValue([]),
      clear: vi.fn(),
    } as unknown as ExtensionRuntime["sessionRules"],
    permissionForwardingContext: null,
    permissionForwardingTimer: null,
    isProcessingForwardedRequests: false,
    writeDebugLog: vi.fn(),
    writeReviewLog: vi.fn(),
  } as ExtensionRuntime;
}

function makeDeps(
  state: "allow" | "deny" | "ask" = "allow",
  overrides: Partial<HandlerDeps> = {},
): HandlerDeps {
  return {
    runtime: makeRuntime(state),
    events: makeEvents(),
    createPermissionManagerForCwd: vi.fn(),
    refreshExtensionConfig: vi.fn(),
    notifyWarning: vi.fn(),
    logResolvedConfigPaths: vi.fn(),
    resolveAgentName: vi.fn().mockReturnValue(null),
    canRequestPermissionConfirmation: vi.fn().mockReturnValue(true),
    promptPermission: vi
      .fn()
      .mockResolvedValue({ approved: true, state: "approved" }),
    createPermissionRequestId: vi.fn().mockReturnValue("req-id"),
    startForwardedPermissionPolling: vi.fn(),
    stopForwardedPermissionPolling: vi.fn(),
    stopPermissionRpcHandlers: vi.fn(),
    getAllTools: vi.fn().mockReturnValue([]),
    setActiveTools: vi.fn(),
    ...overrides,
  };
}

function getDecisionEvents(deps: HandlerDeps): PermissionDecisionEvent[] {
  const emitMock = (deps.events as ReturnType<typeof makeEvents>).emit;
  return emitMock.mock.calls
    .filter(([channel]) => channel === PERMISSIONS_DECISION_CHANNEL)
    .map(([, payload]) => payload as PermissionDecisionEvent);
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("handleInput decision events — skill gate", () => {
  it("does not emit when input is not a skill invocation", async () => {
    const deps = makeDeps();
    await handleInput(deps, { text: "hello world" }, makeCtx());
    expect(getDecisionEvents(deps)).toHaveLength(0);
  });

  it("emits allow with policy_allow for an allowed skill", async () => {
    const deps = makeDeps("allow");
    await handleInput(deps, { text: "/skill:librarian" }, makeCtx());

    const events = getDecisionEvents(deps);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      surface: "skill",
      value: "librarian",
      result: "allow",
      resolution: "policy_allow",
    });
  });

  it("emits deny with policy_deny for a denied skill", async () => {
    const deps = makeDeps("deny");
    await handleInput(deps, { text: "/skill:restricted" }, makeCtx());

    const events = getDecisionEvents(deps);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      surface: "skill",
      value: "restricted",
      result: "deny",
      resolution: "policy_deny",
    });
  });

  it("emits allow with user_approved when state=ask and user approves", async () => {
    const deps = makeDeps("ask", {
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" }),
    });
    await handleInput(deps, { text: "/skill:explorer" }, makeCtx());

    const events = getDecisionEvents(deps);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      surface: "skill",
      value: "explorer",
      result: "allow",
      resolution: "user_approved",
    });
  });

  it("emits deny with user_denied when state=ask and user denies", async () => {
    const deps = makeDeps("ask", {
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: false, state: "denied" }),
    });
    await handleInput(deps, { text: "/skill:explorer" }, makeCtx());

    const events = getDecisionEvents(deps);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      surface: "skill",
      value: "explorer",
      result: "deny",
      resolution: "user_denied",
    });
  });

  it("emits deny with confirmation_unavailable when state=ask but no UI", async () => {
    const deps = makeDeps("ask", {
      canRequestPermissionConfirmation: vi.fn().mockReturnValue(false),
    });
    await handleInput(
      deps,
      { text: "/skill:explorer" },
      makeCtx({ hasUI: false }),
    );

    const events = getDecisionEvents(deps);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      surface: "skill",
      value: "explorer",
      result: "deny",
      resolution: "confirmation_unavailable",
    });
  });

  it("emits allow with auto_approved when promptPermission returns autoApproved:true", async () => {
    const deps = makeDeps("ask", {
      // Simulate what PermissionPrompter returns in yolo mode
      promptPermission: vi.fn().mockResolvedValue({
        approved: true,
        state: "approved",
        autoApproved: true,
      }),
    });
    await handleInput(deps, { text: "/skill:explorer" }, makeCtx());

    const events = getDecisionEvents(deps);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      surface: "skill",
      value: "explorer",
      result: "allow",
      resolution: "auto_approved",
    });
  });
});
