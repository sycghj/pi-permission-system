import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Module mocks (hoisted) ─────────────────────────────────────────────────

const {
  mockGetActiveAgentName,
  mockGetActiveAgentNameFromSystemPrompt,
  mockCreatePermissionManagerForCwd,
  mockRefreshExtensionConfig,
  mockLogResolvedConfigPaths,
  mockCanResolveAskPermissionRequest,
  mockIsSubagentExecutionContext,
} = vi.hoisted(() => ({
  mockGetActiveAgentName: vi.fn<(ctx: ExtensionContext) => string | null>(),
  mockGetActiveAgentNameFromSystemPrompt:
    vi.fn<(systemPrompt?: string) => string | null>(),
  mockCreatePermissionManagerForCwd: vi.fn(),
  mockRefreshExtensionConfig: vi.fn(),
  mockLogResolvedConfigPaths: vi.fn(),
  mockCanResolveAskPermissionRequest: vi.fn(),
  mockIsSubagentExecutionContext: vi.fn(),
}));

vi.mock("../src/active-agent", () => ({
  getActiveAgentName: mockGetActiveAgentName,
  getActiveAgentNameFromSystemPrompt: mockGetActiveAgentNameFromSystemPrompt,
}));

vi.mock("../src/runtime", async (importOriginal) => {
  const original = await importOriginal<typeof import("./src/runtime")>();
  return {
    ...original,
    createPermissionManagerForCwd: mockCreatePermissionManagerForCwd,
    refreshExtensionConfig: mockRefreshExtensionConfig,
    logResolvedConfigPaths: mockLogResolvedConfigPaths,
  };
});

vi.mock("../src/yolo-mode", () => ({
  canResolveAskPermissionRequest: mockCanResolveAskPermissionRequest,
  isYoloModeEnabled: vi.fn().mockReturnValue(false),
  shouldAutoApprovePermissionState: vi.fn().mockReturnValue(false),
}));

vi.mock("../src/subagent-context", () => ({
  isSubagentExecutionContext: mockIsSubagentExecutionContext,
}));

// ── Test helpers ───────────────────────────────────────────────────────────

import type { ExtensionPaths } from "../src/extension-paths";
import type { ForwardingController } from "../src/forwarding-manager";
import type { PermissionPromptDecision } from "../src/permission-dialog";
import type { PermissionManager } from "../src/permission-manager";
import type { PermissionPrompterApi } from "../src/permission-prompter";
import { PermissionSession } from "../src/permission-session";
import type { SessionLogger } from "../src/session-logger";
import type { PermissionCheckResult } from "../src/types";

function makePaths(overrides: Partial<ExtensionPaths> = {}): ExtensionPaths {
  return {
    agentDir: "/test/agent",
    sessionsDir: "/test/agent/sessions",
    subagentSessionsDir: "/test/agent/subagent-sessions",
    forwardingDir: "/test/agent/sessions/permission-forwarding",
    globalLogsDir: "/test/agent/logs",
    piInfrastructureDirs: ["/test/agent", "/test/agent/git"],
    ...overrides,
  };
}

function makeLogger(): SessionLogger {
  return {
    debug: vi.fn(),
    review: vi.fn(),
    warn: vi.fn(),
  };
}

function makePrompter(): PermissionPrompterApi {
  return {
    prompt: vi.fn<PermissionPrompterApi["prompt"]>().mockResolvedValue({
      approved: true,
      state: "approved",
    } as PermissionPromptDecision),
  };
}

function makeForwarding(): ForwardingController {
  return {
    start: vi.fn(),
    stop: vi.fn(),
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

function makePermissionManager(
  overrides: Partial<PermissionManager> = {},
): PermissionManager {
  return {
    checkPermission: vi.fn().mockReturnValue({
      state: "allow",
      toolName: "read",
      source: "tool",
      origin: "builtin",
    } as PermissionCheckResult),
    getToolPermission: vi.fn().mockReturnValue("allow"),
    getConfigIssues: vi.fn().mockReturnValue([]),
    getPolicyCacheStamp: vi.fn().mockReturnValue("stamp-1"),
    getComposedConfigRules: vi.fn().mockReturnValue([]),
    getResolvedPolicyPaths: vi.fn().mockReturnValue({}),
    ...overrides,
  } as unknown as PermissionManager;
}

function createSession(overrides?: {
  paths?: Partial<ExtensionPaths>;
  logger?: SessionLogger;
  prompter?: PermissionPrompterApi;
  forwarding?: ForwardingController;
}): {
  session: PermissionSession;
  paths: ExtensionPaths;
  logger: SessionLogger;
  prompter: PermissionPrompterApi;
  forwarding: ForwardingController;
} {
  const paths = makePaths(overrides?.paths);
  const logger = overrides?.logger ?? makeLogger();
  const prompter = overrides?.prompter ?? makePrompter();
  const forwarding = overrides?.forwarding ?? makeForwarding();
  const session = new PermissionSession(paths, logger, prompter, forwarding);
  return { session, paths, logger, prompter, forwarding };
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetActiveAgentName.mockReset();
  mockGetActiveAgentNameFromSystemPrompt.mockReset();
  mockCreatePermissionManagerForCwd.mockReset();
  mockRefreshExtensionConfig.mockReset();
  mockLogResolvedConfigPaths.mockReset();
  mockCanResolveAskPermissionRequest.mockReset();
  mockIsSubagentExecutionContext.mockReset();

  // Default: createPermissionManagerForCwd returns a fresh mock PM
  mockCreatePermissionManagerForCwd.mockReturnValue(makePermissionManager());
  mockGetActiveAgentName.mockReturnValue(null);
  mockGetActiveAgentNameFromSystemPrompt.mockReturnValue(null);
  mockCanResolveAskPermissionRequest.mockReturnValue(true);
  mockIsSubagentExecutionContext.mockReturnValue(false);
});

describe("PermissionSession", () => {
  describe("constructor and delegation", () => {
    it("delegates checkPermission to internal PermissionManager", () => {
      const pm = makePermissionManager();
      mockCreatePermissionManagerForCwd.mockReturnValue(pm);
      const { session } = createSession();

      const result = session.checkPermission("bash", { command: "ls" });

      expect(pm.checkPermission).toHaveBeenCalledWith(
        "bash",
        { command: "ls" },
        undefined,
        undefined,
      );
      expect(result.state).toBe("allow");
    });

    it("delegates getToolPermission to internal PermissionManager", () => {
      const pm = makePermissionManager();
      mockCreatePermissionManagerForCwd.mockReturnValue(pm);
      const { session } = createSession();

      const result = session.getToolPermission("read");

      expect(pm.getToolPermission).toHaveBeenCalledWith("read", undefined);
      expect(result).toBe("allow");
    });

    it("delegates getConfigIssues to internal PermissionManager", () => {
      const pm = makePermissionManager({
        getConfigIssues: vi.fn().mockReturnValue(["issue1"]),
      });
      mockCreatePermissionManagerForCwd.mockReturnValue(pm);
      const { session } = createSession();

      expect(session.getConfigIssues("agent1")).toEqual(["issue1"]);
      expect(pm.getConfigIssues).toHaveBeenCalledWith("agent1");
    });

    it("delegates getPolicyCacheStamp to internal PermissionManager", () => {
      const pm = makePermissionManager();
      mockCreatePermissionManagerForCwd.mockReturnValue(pm);
      const { session } = createSession();

      expect(session.getPolicyCacheStamp("agent1")).toBe("stamp-1");
      expect(pm.getPolicyCacheStamp).toHaveBeenCalledWith("agent1");
    });

    it("delegates getSessionRuleset to internal SessionRules", () => {
      const { session } = createSession();
      const rules = session.getSessionRuleset();
      expect(rules).toEqual([]);
    });

    it("delegates approveSessionRule to internal SessionRules", () => {
      const { session } = createSession();
      session.approveSessionRule("bash", "/usr/bin/*");
      const rules = session.getSessionRuleset();
      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({
        surface: "bash",
        pattern: "/usr/bin/*",
        action: "allow",
      });
    });
  });

  describe("activate and deactivate", () => {
    it("stores the context on activate", () => {
      const { session, forwarding } = createSession();
      const ctx = makeCtx();

      session.activate(ctx);

      expect(forwarding.start).toHaveBeenCalledWith(ctx);
    });

    it("clears context on deactivate", () => {
      const { session, forwarding } = createSession();
      session.activate(makeCtx());
      session.deactivate();

      expect(forwarding.stop).toHaveBeenCalled();
    });
  });
});
