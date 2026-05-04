export type PermissionState = "allow" | "deny" | "ask";

export type BuiltInToolName =
  | "bash"
  | "read"
  | "write"
  | "edit"
  | "grep"
  | "find"
  | "ls";

export type SpecialPermissionName = "external_directory";

export interface PermissionDefaultPolicy {
  tools: PermissionState;
  bash: PermissionState;
  mcp: PermissionState;
  skills: PermissionState;
  special: PermissionState;
}

/**
 * Per-scope permission config shape after loading and validation.
 * All fields optional — each scope may define a subset of the policy.
 *
 * This replaces the former AgentPermissions / GlobalPermissionConfig
 * interfaces (removed in #56).
 */
export interface ScopeConfig {
  defaultPolicy?: Partial<PermissionDefaultPolicy>;
  tools?: Record<string, PermissionState>;
  bash?: Record<string, PermissionState>;
  mcp?: Record<string, PermissionState>;
  skills?: Record<string, PermissionState>;
  special?: Record<string, PermissionState>;
}

export interface PermissionCheckResult {
  toolName: string;
  state: PermissionState;
  matchedPattern?: string;
  command?: string;
  target?: string;
  source: "tool" | "bash" | "mcp" | "skill" | "special" | "default" | "session";
}
