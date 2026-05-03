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
}

/** An ordered list of rules. Later rules take priority (last-match-wins). */
export type Ruleset = Rule[];

const SURFACE_DEFAULTS: Record<string, PermissionState> = {
  tools: "ask",
  bash: "ask",
  mcp: "ask",
  skill: "ask",
  special: "ask",
};

/**
 * Returns the default action for a surface when no rules match.
 * Defaults to "ask" for unknown surfaces (least privilege).
 */
export function getDefaultAction(surface: string): PermissionState {
  return SURFACE_DEFAULTS[surface] ?? "ask";
}

/**
 * Pure permission evaluation.
 *
 * Flattens all provided rulesets and returns the last rule whose surface and
 * pattern both wildcard-match the supplied values (last-match-wins, so later
 * rulesets / later entries have higher priority).
 *
 * When no rule matches, returns a synthetic rule using getDefaultAction().
 */
export function evaluate(
  surface: string,
  pattern: string,
  ...rulesets: Ruleset[]
): Rule {
  const rules = rulesets.flat();
  const match = rules.findLast(
    (rule) =>
      wildcardMatch(rule.surface, surface) &&
      wildcardMatch(rule.pattern, pattern),
  );
  return match ?? { surface, pattern, action: getDefaultAction(surface) };
}
