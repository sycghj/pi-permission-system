import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import type { ExtensionPaths } from "./extension-paths";
import type { ForwardingController } from "./forwarding-manager";
import type { PermissionManager } from "./permission-manager";
import type { PermissionPrompterApi } from "./permission-prompter";
import type { Rule } from "./rule";
import { createPermissionManagerForCwd } from "./runtime";
import type { SessionLogger } from "./session-logger";
import { SessionRules } from "./session-rules";
import type { SkillPromptEntry } from "./skill-prompt-sanitizer";
import type { PermissionCheckResult, PermissionState } from "./types";

/**
 * Encapsulates all mutable session state and exposes operations instead of
 * fields.
 *
 * Replaces the `SessionState` interface + scattered handler field mutations
 * with a single class that owns the `PermissionManager`, `SessionRules`,
 * cache keys, skill entries, and runtime context.
 *
 * Constructor takes 4 high-level deps:
 * - `ExtensionPaths` (immutable path constants)
 * - `SessionLogger` (debug + review + warn)
 * - `PermissionPrompterApi` (interactive permission prompting)
 * - `ForwardingController` (polling lifecycle)
 */
export class PermissionSession {
  private context: ExtensionContext | null = null;
  private permissionManager: PermissionManager;
  private readonly sessionRules = new SessionRules();
  private activeSkillEntries: SkillPromptEntry[] = [];
  private knownAgentName: string | null = null;
  private activeToolsCacheKey: string | null = null;
  private promptStateCacheKey: string | null = null;

  constructor(
    private readonly paths: ExtensionPaths,
    readonly logger: SessionLogger,
    private readonly prompter: PermissionPrompterApi,
    private readonly forwarding: ForwardingController,
  ) {
    this.permissionManager = createPermissionManagerForCwd(
      paths.agentDir,
      undefined,
    );
  }

  // ── Context lifecycle ──────────────────────────────────────────────────

  /** Store the current extension context and start forwarding. */
  activate(ctx: ExtensionContext): void {
    this.context = ctx;
    this.forwarding.start(ctx);
  }

  /** Clear the context and stop forwarding. */
  deactivate(): void {
    this.context = null;
    this.forwarding.stop();
  }

  // ── Permission checking (delegates to PermissionManager) ───────────────

  checkPermission(
    surface: string,
    input: unknown,
    agentName?: string,
    sessionRules?: Rule[],
  ): PermissionCheckResult {
    return this.permissionManager.checkPermission(
      surface,
      input,
      agentName,
      sessionRules,
    );
  }

  getToolPermission(toolName: string, agentName?: string): PermissionState {
    return this.permissionManager.getToolPermission(toolName, agentName);
  }

  getConfigIssues(agentName?: string): string[] {
    return this.permissionManager.getConfigIssues(agentName);
  }

  getPolicyCacheStamp(agentName?: string): string {
    return this.permissionManager.getPolicyCacheStamp(agentName);
  }

  // ── Session rules (delegates to SessionRules) ──────────────────────────

  getSessionRuleset(): Rule[] {
    return this.sessionRules.getRuleset();
  }

  approveSessionRule(surface: string, pattern: string): void {
    this.sessionRules.approve(surface, pattern);
  }
}
