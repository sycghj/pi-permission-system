import type { Rule, Ruleset } from "./rule";
import type { PermissionDefaultPolicy, PermissionState } from "./types";

/**
 * Convert the merged `defaultPolicy` into catch-all rules at the lowest
 * priority position in the composed ruleset.
 *
 * Produces 5 rules:
 * 1. `{ surface: "*", pattern: "*" }` — universal fallback (tools default)
 * 2. `{ surface: "bash", pattern: "*" }` — bash default
 * 3. `{ surface: "mcp", pattern: "*" }` — mcp default
 * 4. `{ surface: "skill", pattern: "*" }` — skill default
 * 5. `{ surface: "special", pattern: "*" }` — special / external_directory default
 *
 * All rules carry `layer: "default"`. `evaluate()` ignores this field.
 * The specific per-surface rules come after the universal rule so they win
 * via last-match-wins when a surface-specific default differs from the
 * tools default.
 */
export function synthesizeDefaults(defaults: PermissionDefaultPolicy): Ruleset {
  return [
    { surface: "*", pattern: "*", action: defaults.tools, layer: "default" },
    { surface: "bash", pattern: "*", action: defaults.bash, layer: "default" },
    { surface: "mcp", pattern: "*", action: defaults.mcp, layer: "default" },
    {
      surface: "skill",
      pattern: "*",
      action: defaults.skills,
      layer: "default",
    },
    {
      surface: "special",
      pattern: "*",
      action: defaults.special,
      layer: "default",
    },
  ];
}

/**
 * Per-scope override shape — the relevant keys extracted from `tools`.
 * `undefined` means the scope did not configure that override.
 */
export interface OverrideScope {
  bash?: PermissionState;
  mcp?: PermissionState;
}

/**
 * Convert per-scope `tools.bash` / `tools.mcp` entries into catch-all rules
 * placed between defaults and config rules.
 *
 * Scopes must be passed in precedence order (lowest first, e.g. global →
 * project → agent → project-agent). Later scopes produce later rules and
 * therefore win via last-match-wins — identical to the current last-scope-wins
 * logic for `bashDefault` / `mcpToolLevel`.
 *
 * Only scopes that explicitly define a value contribute a rule; `undefined`
 * entries are skipped.
 *
 * All rules carry `layer: "override"`.
 */
export function synthesizeOverrides(
  scopes: ReadonlyArray<OverrideScope>,
): Ruleset {
  const rules: Rule[] = [];
  for (const scope of scopes) {
    if (scope.bash !== undefined) {
      rules.push({
        surface: "bash",
        pattern: "*",
        action: scope.bash,
        layer: "override",
      });
    }
    if (scope.mcp !== undefined) {
      rules.push({
        surface: "mcp",
        pattern: "*",
        action: scope.mcp,
        layer: "override",
      });
    }
  }
  return rules;
}

/**
 * MCP metadata operation targets that are auto-allowed when any explicit MCP
 * allow rule exists in the config layer.
 */
const MCP_BASELINE_TARGETS: readonly string[] = [
  "mcp_status",
  "mcp_list",
  "mcp_search",
  "mcp_describe",
  "mcp_connect",
];

/**
 * Conditionally synthesize MCP baseline auto-allow rules.
 *
 * Emits allow rules for the 5 MCP metadata targets only when `configRules`
 * contains at least one `surface: "mcp", action: "allow"` rule. This replicates
 * the `hasAnyMcpAllowRule` heuristic as actual rules.
 *
 * When `defaults.mcp === "allow"`, the synthesized default catch-all already
 * covers all MCP targets — no separate baseline rules are needed (and this
 * function is not called in that case).
 *
 * Baseline rules are placed BEFORE override rules in the composed array so
 * that `tools.mcp` overrides beat baseline (preserving current behaviour where
 * an explicit `tools.mcp` value always terminates the MCP decision).
 *
 * All rules carry `layer: "baseline"`.
 */
export function synthesizeBaseline(configRules: Ruleset): Ruleset {
  const hasAnyMcpAllow = configRules.some(
    (r) => r.surface === "mcp" && r.action === "allow",
  );
  if (!hasAnyMcpAllow) {
    return [];
  }
  return MCP_BASELINE_TARGETS.map(
    (target): Rule => ({
      surface: "mcp",
      pattern: target,
      action: "allow",
      layer: "baseline",
    }),
  );
}

/**
 * Concatenate all rule layers into a single flat ruleset.
 *
 * Priority order (lowest → highest, i.e. earlier index → later index):
 *   defaults → baseline → overrides → config
 *
 * Session rules are NOT included here — they are appended at call-time inside
 * `checkPermission()` so that the cached composed ruleset remains session-agnostic.
 *
 * `evaluate()` scans from the end, so later layers override earlier ones.
 */
export function composeRuleset(
  defaults: Ruleset,
  baseline: Ruleset,
  overrides: Ruleset,
  config: Ruleset,
): Ruleset {
  return [...defaults, ...baseline, ...overrides, ...config];
}
