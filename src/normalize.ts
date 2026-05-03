import type { Rule, Ruleset } from "./rule";
import type { PermissionState } from "./types";

/**
 * Subset of UnifiedPermissionConfig covering only policy fields.
 * Used as the input shape for normalizeConfig().
 */
export interface NormalizableConfig {
  tools?: Record<string, PermissionState>;
  bash?: Record<string, PermissionState>;
  mcp?: Record<string, PermissionState>;
  skills?: Record<string, PermissionState>;
  special?: Record<string, PermissionState>;
}

/**
 * Convert the on-disk config shape into a flat Ruleset.
 *
 * Ordering within a scope:
 * 1. tools entries (tool-name-as-surface, pattern "*")
 * 2. bash entries (surface "bash", pattern = command glob)
 * 3. mcp entries (surface "mcp", pattern = target glob)
 * 4. skills entries (surface "skill", pattern = skill glob)
 * 5. special entries (key-as-surface, pattern "*")
 *
 * defaultPolicy is NOT included — handled separately by the caller.
 */
export function normalizeConfig(config: NormalizableConfig): Ruleset {
  const rules: Rule[] = [];

  for (const [name, action] of Object.entries(config.tools ?? {})) {
    rules.push({ surface: name, pattern: "*", action });
  }

  for (const [pattern, action] of Object.entries(config.bash ?? {})) {
    rules.push({ surface: "bash", pattern, action });
  }

  for (const [pattern, action] of Object.entries(config.mcp ?? {})) {
    rules.push({ surface: "mcp", pattern, action });
  }

  for (const [pattern, action] of Object.entries(config.skills ?? {})) {
    rules.push({ surface: "skill", pattern, action });
  }

  for (const [name, action] of Object.entries(config.special ?? {})) {
    rules.push({ surface: name, pattern: "*", action });
  }

  return rules;
}
