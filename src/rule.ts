import type { PermissionState } from "./types";
import { wildcardMatch } from "./wildcard-matcher";

/** A single permission rule — the atomic unit of policy. */
export interface Rule {
  /** The permission surface: "bash", "read", "mcp", "skill", "external_directory", etc. */
  surface: string;
  /** The match pattern: a command glob, tool name, skill name, or "*". */
  pattern: string;
  /** The permission decision. */
  action: PermissionState;
  /**
   * Origin layer — used to derive PermissionCheckResult.source after evaluation.
   * Not used by evaluate(); purely informational metadata.
   */
  layer?: "default" | "override" | "baseline" | "config" | "session";
}

/** An ordered list of rules. Later rules take priority (last-match-wins). */
export type Ruleset = Rule[];

/**
 * Pure permission evaluation.
 *
 * Returns the last rule in `rules` whose surface and pattern both
 * wildcard-match the supplied values (last-match-wins).
 *
 * When no rule matches, returns a synthetic rule with `defaultAction`
 * (defaults to "ask" — least privilege).
 */
export function evaluate(
  surface: string,
  pattern: string,
  rules: Ruleset,
  defaultAction?: PermissionState,
): Rule {
  for (let i = rules.length - 1; i >= 0; i -= 1) {
    const rule = rules[i];
    if (
      wildcardMatch(rule.surface, surface) &&
      wildcardMatch(rule.pattern, pattern)
    ) {
      return rule;
    }
  }
  return { surface, pattern, action: defaultAction ?? "ask" };
}
