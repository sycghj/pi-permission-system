import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import type { PermissionPromptDecision } from "../permission-dialog";
import type { PermissionManager } from "../permission-manager";
import type { SessionApprovalCache } from "../session-approval-cache";
import type { SkillPromptEntry } from "../skill-prompt-sanitizer";

export type PermissionReviewSource = "tool_call" | "skill_input" | "skill_read";

/** Details passed when prompting the user for a permission decision. */
export interface PromptPermissionDetails {
  requestId: string;
  source: PermissionReviewSource;
  agentName: string | null;
  message: string;
  toolCallId?: string;
  toolName?: string;
  skillName?: string;
  path?: string;
  command?: string;
  target?: string;
  toolInputPreview?: string;
}

/**
 * Explicit dependency bag passed to each extracted event handler.
 *
 * All mutable shared state is wrapped in getter/setter pairs so that:
 * - Tests can construct a plain object with stubs and exercise handlers in
 *   isolation without importing src/index.ts.
 * - Issue #43 can replace this interface with ExtensionRuntime without
 *   changing handler signatures — only the deps object construction in
 *   index.ts needs to change.
 */
export interface HandlerDeps {
  // ── Mutable state accessors ────────────────────────────────────────────
  getPermissionManager(): PermissionManager;
  setPermissionManager(pm: PermissionManager): void;
  getRuntimeContext(): ExtensionContext | null;
  setRuntimeContext(ctx: ExtensionContext | null): void;
  getActiveSkillEntries(): SkillPromptEntry[];
  setActiveSkillEntries(entries: SkillPromptEntry[]): void;
  getLastKnownActiveAgentName(): string | null;
  setLastKnownActiveAgentName(name: string | null): void;
  /** Cache key for the last set of active tools passed to setActiveTools(). */
  getLastActiveToolsCacheKey(): string | null;
  setLastActiveToolsCacheKey(key: string | null): void;
  /** Cache key for the last before_agent_start prompt state. */
  getLastPromptStateCacheKey(): string | null;
  setLastPromptStateCacheKey(key: string | null): void;
  /** Session-scoped approval cache (passed by reference; mutations are visible). */
  sessionApprovalCache: SessionApprovalCache;

  // ── Factories ──────────────────────────────────────────────────────────
  /** Create a new PermissionManager scoped to cwd's config hierarchy. */
  createPermissionManagerForCwd(
    cwd: string | undefined | null,
  ): PermissionManager;

  // ── Config & lifecycle helpers ─────────────────────────────────────────
  /** Reload merged config from disk; optionally update the stored runtime context. */
  refreshExtensionConfig(ctx?: ExtensionContext): void;
  /** Show a warning notification to the user (no-op when no UI is available). */
  notifyWarning(message: string): void;
  /** Write the resolved config path set to the review and debug logs. */
  logResolvedConfigPaths(): void;

  // ── Permission helpers ─────────────────────────────────────────────────
  /**
   * Resolve the active agent name from the session context or system prompt.
   * Updates the stored lastKnownActiveAgentName as a side effect.
   */
  resolveAgentName(ctx: ExtensionContext, systemPrompt?: string): string | null;
  /** Whether the current context can show an interactive permission prompt. */
  canRequestPermissionConfirmation(ctx: ExtensionContext): boolean;
  /** Prompt the user for a permission decision, log the outcome, and return it. */
  promptPermission(
    ctx: ExtensionContext,
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision>;
  /** Generate a unique ID for a permission request. */
  createPermissionRequestId(prefix: string): string;

  // ── Forwarding ─────────────────────────────────────────────────────────
  startForwardedPermissionPolling(ctx: ExtensionContext): void;
  stopForwardedPermissionPolling(): void;

  // ── Logging ────────────────────────────────────────────────────────────
  writeReviewLog(event: string, details?: Record<string, unknown>): void;
  writeDebugLog(event: string, details?: Record<string, unknown>): void;

  // ── Pi API subset ──────────────────────────────────────────────────────
  getAllTools(): unknown[];
  setActiveTools(names: string[]): void;
}
