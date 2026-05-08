import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleResourcesDiscover,
  handleSessionShutdown,
  handleSessionStart,
} from "../../src/handlers/lifecycle";
import type { HandlerDeps } from "../../src/handlers/types";
import type { PermissionSession } from "../../src/permission-session";

// ── status stub ────────────────────────────────────────────────────────────
vi.mock("../../src/status", () => ({
  PERMISSION_SYSTEM_STATUS_KEY: "permission-system",
  syncPermissionSystemStatus: vi.fn(),
  getPermissionSystemStatus: vi.fn(),
}));

// ── helpers ────────────────────────────────────────────────────────────────

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

function makeSession(
  overrides: Partial<Record<keyof PermissionSession, unknown>> = {},
): PermissionSession {
  return {
    logger: { debug: vi.fn(), review: vi.fn(), warn: vi.fn() },
    refreshConfig: vi.fn(),
    resetForNewSession: vi.fn(),
    logResolvedConfigPaths: vi.fn(),
    resolveAgentName: vi.fn().mockReturnValue(null),
    getConfigIssues: vi.fn().mockReturnValue([]),
    reload: vi.fn(),
    getRuntimeContext: vi.fn().mockReturnValue(null),
    shutdown: vi.fn(),
    ...overrides,
  } as unknown as PermissionSession;
}

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    session: makeSession(),
    events: { emit: vi.fn(), on: vi.fn().mockReturnValue(() => undefined) },
    canRequestPermissionConfirmation: vi.fn().mockReturnValue(false),
    promptPermission: vi
      .fn()
      .mockResolvedValue({ approved: true, state: "approved" }),
    createPermissionRequestId: vi.fn().mockReturnValue("test-id"),
    stopPermissionRpcHandlers: vi.fn(),
    getAllTools: vi.fn().mockReturnValue([]),
    setActiveTools: vi.fn(),
    ...overrides,
  };
}

// ── handleSessionStart ─────────────────────────────────────────────────────

describe("handleSessionStart", () => {
  it("refreshes config with ctx", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await handleSessionStart(deps, { reason: "startup" }, ctx);
    expect(deps.session.refreshConfig).toHaveBeenCalledWith(ctx);
  });

  it("calls resetForNewSession with ctx", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await handleSessionStart(deps, { reason: "startup" }, ctx);
    expect(deps.session.resetForNewSession).toHaveBeenCalledWith(ctx);
  });

  it("logs resolved config paths", async () => {
    const deps = makeDeps();
    await handleSessionStart(deps, { reason: "startup" }, makeCtx());
    expect(deps.session.logResolvedConfigPaths).toHaveBeenCalledOnce();
  });

  it("resolves agent name from ctx", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await handleSessionStart(deps, { reason: "startup" }, ctx);
    expect(deps.session.resolveAgentName).toHaveBeenCalledWith(ctx);
  });

  it("notifies each policy issue", async () => {
    const session = makeSession({
      getConfigIssues: vi.fn().mockReturnValue(["issue A", "issue B"]),
    });
    const deps = makeDeps({ session });
    await handleSessionStart(deps, { reason: "startup" }, makeCtx());
    expect(session.logger.warn).toHaveBeenCalledWith("issue A");
    expect(session.logger.warn).toHaveBeenCalledWith("issue B");
  });

  it("does not warn when there are no policy issues", async () => {
    const deps = makeDeps();
    await handleSessionStart(deps, { reason: "startup" }, makeCtx());
    expect(deps.session.logger.warn).not.toHaveBeenCalled();
  });

  it("writes lifecycle.reload debug log when reason is reload", async () => {
    const ctx = makeCtx({ cwd: "/proj" });
    const deps = makeDeps();
    await handleSessionStart(deps, { reason: "reload" }, ctx);
    expect(deps.session.logger.debug).toHaveBeenCalledWith("lifecycle.reload", {
      triggeredBy: "session_start",
      reason: "reload",
      cwd: "/proj",
    });
  });

  it("does not write lifecycle.reload debug log for non-reload reasons", async () => {
    const deps = makeDeps();
    await handleSessionStart(deps, { reason: "startup" }, makeCtx());
    expect(deps.session.logger.debug).not.toHaveBeenCalled();
  });

  it("calls refreshConfig before resetForNewSession", async () => {
    const callOrder: string[] = [];
    const session = makeSession({
      refreshConfig: vi.fn(() => callOrder.push("refreshConfig")),
      resetForNewSession: vi.fn(() => callOrder.push("resetForNewSession")),
    });
    const deps = makeDeps({ session });
    await handleSessionStart(deps, { reason: "startup" }, makeCtx());
    expect(callOrder).toEqual(["refreshConfig", "resetForNewSession"]);
  });
});

// ── handleResourcesDiscover ────────────────────────────────────────────────

describe("handleResourcesDiscover", () => {
  it("does nothing when reason is not reload", async () => {
    const deps = makeDeps();
    await handleResourcesDiscover(deps, { reason: "startup" });
    expect(deps.session.reload).not.toHaveBeenCalled();
  });

  it("calls reload on the session on reload", async () => {
    const deps = makeDeps();
    await handleResourcesDiscover(deps, { reason: "reload" });
    expect(deps.session.reload).toHaveBeenCalledOnce();
  });

  it("writes lifecycle.reload debug log on reload", async () => {
    const ctx = makeCtx({ cwd: "/proj" });
    const session = makeSession({
      getRuntimeContext: vi.fn().mockReturnValue(ctx),
    });
    const deps = makeDeps({ session });
    await handleResourcesDiscover(deps, { reason: "reload" });
    expect(session.logger.debug).toHaveBeenCalledWith("lifecycle.reload", {
      triggeredBy: "resources_discover",
      reason: "reload",
      cwd: "/proj",
    });
  });

  it("logs cwd as null when runtimeContext is null on reload", async () => {
    const deps = makeDeps();
    await handleResourcesDiscover(deps, { reason: "reload" });
    expect(deps.session.logger.debug).toHaveBeenCalledWith("lifecycle.reload", {
      triggeredBy: "resources_discover",
      reason: "reload",
      cwd: null,
    });
  });
});

// ── handleSessionShutdown ──────────────────────────────────────────────────

describe("handleSessionShutdown", () => {
  it("clears UI status when runtime context is present", async () => {
    const ctx = makeCtx();
    const session = makeSession({
      getRuntimeContext: vi.fn().mockReturnValue(ctx),
    });
    const deps = makeDeps({ session });
    await handleSessionShutdown(deps);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith(
      "permission-system",
      undefined,
    );
  });

  it("does not throw when runtime context is null", async () => {
    const deps = makeDeps();
    await expect(handleSessionShutdown(deps)).resolves.not.toThrow();
  });

  it("calls shutdown on the session", async () => {
    const deps = makeDeps();
    await handleSessionShutdown(deps);
    expect(deps.session.shutdown).toHaveBeenCalledOnce();
  });

  it("calls stopPermissionRpcHandlers", async () => {
    const deps = makeDeps();
    await handleSessionShutdown(deps);
    expect(deps.stopPermissionRpcHandlers).toHaveBeenCalledOnce();
  });
});
