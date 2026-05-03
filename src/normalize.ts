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
 * Keys in the `tools` map that serve as fallback defaults for their
 * respective pattern-based surfaces rather than as tool-level rules.
 *
 * `tools.bash` sets the bash default (fallback when no bash pattern matches).
 * `tools.mcp` sets the tool-level MCP fallback.
 *
 * These are NOT normalized into the Ruleset — they are extracted by the
 * caller and handled as separate fallbacks to preserve the semantic that
 * specific bash/mcp patterns always have priority.
 */
export const TOOL_SURFACE_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  "bash",
  "mcp",
]);

/**
 * Convert the on-disk config shape into a flat Ruleset.
 *
 * Ordering within a scope:
 * 1. tools entries (tool-name-as-surface, pattern "*") — excluding bash/mcp
 * 2. bash entries (surface "bash", pattern = command glob)
 * 3. mcp entries (surface "mcp", pattern = target glob)
 * 4. skills entries (surface "skill", pattern = skill glob)
 * 5. special entries (surface "special", pattern = key name)
 *
 * `tools.bash` and `tools.mcp` are excluded — see TOOL_SURFACE_OVERRIDE_KEYS.
 * `defaultPolicy` is NOT included — handled separately by the caller.
 */
export function normalizeConfig(config: NormalizableConfig): Ruleset {
  const rules: Rule[] = [];

  for (const [name, action] of Object.entries(config.tools ?? {})) {
    if (TOOL_SURFACE_OVERRIDE_KEYS.has(name)) continue;
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
    rules.push({ surface: "special", pattern: name, action });
  }

  return rules;
}
