import { getGlobalLogsDir } from "./config-paths";
import { discoverGlobalNodeModulesRoot } from "./node-modules-discovery";

/**
 * Immutable path constants derived from `agentDir` at construction time.
 *
 * Computed once at startup in `computeExtensionPaths()` and embedded into
 * `ExtensionRuntime`. Later refactorings (#129 PermissionSession, #130
 * handler classes) consume this as a single dep instead of individual fields.
 */
export interface ExtensionPaths {
  readonly agentDir: string;
  readonly sessionsDir: string;
  readonly subagentSessionsDir: string;
  readonly forwardingDir: string;
  readonly globalLogsDir: string;
  /**
   * Static Pi infrastructure directories used for external-directory
   * read auto-allow. Computed once from `agentDir`,
   * `discoverGlobalNodeModulesRoot()`, and (when provided) Pi's own
   * install directory (`getPackageDir()`). Config-based extras
   * (`piInfrastructureReadPaths`) are read from `runtime.config` at
   * call time in the handler so they pick up config reloads.
   */
  readonly piInfrastructureDirs: readonly string[];
}

/**
 * Compute all immutable path constants from `agentDir`.
 *
 * Calls `discoverGlobalNodeModulesRoot()` internally so the result is
 * self-contained. Call this once at extension startup, not at module scope.
 *
 * `piPackageDir` is Pi's own install directory (from the coding-agent
 * `getPackageDir()` API, resolved at the composition root). When provided it is
 * auto-allowed for read-only tools so the agent can read Pi's bundled docs and
 * examples regardless of install layout. It is strictly narrower than the
 * discovered global `node_modules` root already included here.
 */
export function computeExtensionPaths(
  agentDir: string,
  piPackageDir?: string,
): ExtensionPaths {
  const sessionsDir = joinPath(agentDir, "sessions");
  const subagentSessionsDir = joinPath(agentDir, "subagent-sessions");
  const forwardingDir = joinPath(sessionsDir, "permission-forwarding");
  const globalLogsDir = getGlobalLogsDir(agentDir);

  const globalNodeModulesRoot = discoverGlobalNodeModulesRoot();
  const piInfrastructureDirs: string[] = [
    agentDir,
    joinPath(agentDir, "git"),
    ...(globalNodeModulesRoot ? [globalNodeModulesRoot] : []),
    ...(piPackageDir ? [piPackageDir] : []),
  ];

  return {
    agentDir,
    sessionsDir,
    subagentSessionsDir,
    forwardingDir,
    globalLogsDir,
    piInfrastructureDirs,
  };
}

function joinPath(base: string, segment: string): string {
  const sep = base.includes("/") ? "/" : "\\";
  return `${base.replace(/[\\/]+$/, "")}${sep}${segment}`;
}
