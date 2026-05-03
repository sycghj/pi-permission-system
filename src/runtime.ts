import { join } from "node:path";
import {
  type ExtensionContext,
  getAgentDir,
} from "@mariozechner/pi-coding-agent";
import {
  DEBUG_LOG_FILENAME,
  getGlobalLogsDir,
  REVIEW_LOG_FILENAME,
} from "./config-paths";
import {
  DEFAULT_EXTENSION_CONFIG,
  ensurePermissionSystemLogsDirectory,
  type PermissionSystemExtensionConfig,
} from "./extension-config";
import { createPermissionSystemLogger } from "./logging";
import { PermissionManager } from "./permission-manager";
import { SessionApprovalCache } from "./session-approval-cache";
import type { SkillPromptEntry } from "./skill-prompt-sanitizer";

/**
 * Runtime context object created once inside `piPermissionSystemExtension()`.
 *
 * Holds all path constants (derived from `getAgentDir()` at construction time),
 * mutable extension state, and the log-writing methods — eliminating the
 * module-scope cached constants and setter-injection pattern that previously
 * lived in `src/index.ts`.
 *
 * Tests construct this via `createExtensionRuntime({ agentDir: tmpDir })`
 * without timing issues around `PI_CODING_AGENT_DIR`.
 */
export interface ExtensionRuntime {
  // ── Immutable paths (derived from agentDir at construction) ───────────
  readonly agentDir: string;
  readonly sessionsDir: string;
  readonly subagentSessionsDir: string;
  readonly forwardingDir: string;
  readonly globalLogsDir: string;

  // ── Mutable state ──────────────────────────────────────────────────────
  config: PermissionSystemExtensionConfig;
  runtimeContext: ExtensionContext | null;
  permissionManager: PermissionManager;
  activeSkillEntries: SkillPromptEntry[];
  lastKnownActiveAgentName: string | null;
  lastActiveToolsCacheKey: string | null;
  lastPromptStateCacheKey: string | null;
  lastConfigWarning: string | null;
  readonly sessionApprovalCache: SessionApprovalCache;

  // ── Forwarding polling state ───────────────────────────────────────────
  permissionForwardingContext: ExtensionContext | null;
  permissionForwardingTimer: NodeJS.Timeout | null;
  isProcessingForwardedRequests: boolean;

  // ── Logging (backed by logger created at construction) ─────────────────
  writeDebugLog(event: string, details?: Record<string, unknown>): void;
  writeReviewLog(event: string, details?: Record<string, unknown>): void;
}

/**
 * Create a fully-initialized `ExtensionRuntime`.
 *
 * Calls `getAgentDir()` at invocation time (never at module scope), so tests
 * may set `PI_CODING_AGENT_DIR` before calling the factory.
 */
export function createExtensionRuntime(options?: {
  agentDir?: string;
}): ExtensionRuntime {
  const agentDir = options?.agentDir ?? getAgentDir();
  const sessionsDir = join(agentDir, "sessions");
  const subagentSessionsDir = join(agentDir, "subagent-sessions");
  const forwardingDir = join(sessionsDir, "permission-forwarding");
  const globalLogsDir = getGlobalLogsDir(agentDir);

  // Build a plain-object runtime first so the logger's `getConfig` closure
  // can reference `runtime.config` directly (always reads current value).
  const runtime: ExtensionRuntime = {
    agentDir,
    sessionsDir,
    subagentSessionsDir,
    forwardingDir,
    globalLogsDir,
    config: { ...DEFAULT_EXTENSION_CONFIG },
    runtimeContext: null,
    permissionManager: new PermissionManager({
      globalConfigPath: undefined, // PermissionManager derives from getAgentDir() internally
    }),
    activeSkillEntries: [],
    lastKnownActiveAgentName: null,
    lastActiveToolsCacheKey: null,
    lastPromptStateCacheKey: null,
    lastConfigWarning: null,
    sessionApprovalCache: new SessionApprovalCache(),
    permissionForwardingContext: null,
    permissionForwardingTimer: null,
    isProcessingForwardedRequests: false,
    // Logging methods are replaced below after the logger is constructed.
    writeDebugLog: () => {},
    writeReviewLog: () => {},
  };

  const reportedLoggingWarnings = new Set<string>();
  const logger = createPermissionSystemLogger({
    // Reads runtime.config at call time — always current.
    getConfig: () => runtime.config,
    debugLogPath: join(globalLogsDir, DEBUG_LOG_FILENAME),
    reviewLogPath: join(globalLogsDir, REVIEW_LOG_FILENAME),
    ensureLogsDirectory: () =>
      ensurePermissionSystemLogsDirectory(globalLogsDir),
  });

  const reportLoggingWarning = (message: string): void => {
    if (reportedLoggingWarnings.has(message)) {
      return;
    }
    reportedLoggingWarnings.add(message);
    // Reads runtime.runtimeContext at call time — always current.
    runtime.runtimeContext?.ui.notify(message, "warning");
  };

  runtime.writeDebugLog = (
    event: string,
    details: Record<string, unknown> = {},
  ): void => {
    const warning = logger.debug(event, details);
    if (warning) {
      reportLoggingWarning(warning);
    }
  };

  runtime.writeReviewLog = (
    event: string,
    details: Record<string, unknown> = {},
  ): void => {
    const warning = logger.review(event, details);
    if (warning) {
      reportLoggingWarning(warning);
    }
  };

  return runtime;
}
