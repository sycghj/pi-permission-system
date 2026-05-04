import { describe, expect, test } from "vitest";
import { evaluate } from "../src/rule";
import {
  composeRuleset,
  synthesizeBaseline,
  synthesizeDefaults,
  synthesizeOverrides,
} from "../src/synthesize";
import type { PermissionDefaultPolicy } from "../src/types";

const ALL_ASK: PermissionDefaultPolicy = {
  tools: "ask",
  bash: "ask",
  mcp: "ask",
  skills: "ask",
  special: "ask",
};

const ALL_ALLOW: PermissionDefaultPolicy = {
  tools: "allow",
  bash: "allow",
  mcp: "allow",
  skills: "allow",
  special: "allow",
};

// ── synthesizeDefaults ─────────────────────────────────────────────────────

describe("synthesizeDefaults", () => {
  test("emits 5 catch-all rules with layer 'default'", () => {
    const rules = synthesizeDefaults(ALL_ASK);
    expect(rules).toHaveLength(5);
    for (const rule of rules) {
      expect(rule.layer).toBe("default");
      expect(rule.pattern).toBe("*");
    }
  });

  test("emits universal catch-all for tools default", () => {
    const rules = synthesizeDefaults(ALL_ASK);
    const universal = rules.find((r) => r.surface === "*");
    expect(universal).toEqual({
      surface: "*",
      pattern: "*",
      action: "ask",
      layer: "default",
    });
  });

  test("emits per-surface catch-alls for bash, mcp, skill, special", () => {
    const rules = synthesizeDefaults(ALL_ASK);
    const surfaces = rules.map((r) => r.surface);
    expect(surfaces).toContain("bash");
    expect(surfaces).toContain("mcp");
    expect(surfaces).toContain("skill");
    expect(surfaces).toContain("special");
  });

  test("reflects non-ask actions correctly", () => {
    const rules = synthesizeDefaults(ALL_ALLOW);
    for (const rule of rules) {
      expect(rule.action).toBe("allow");
    }
  });

  test("mixed defaults produce correct per-surface actions", () => {
    const mixed: PermissionDefaultPolicy = {
      tools: "allow",
      bash: "deny",
      mcp: "ask",
      skills: "allow",
      special: "deny",
    };
    const rules = synthesizeDefaults(mixed);
    const get = (surface: string) => rules.find((r) => r.surface === surface);
    expect(get("*")?.action).toBe("allow"); // tools default
    expect(get("bash")?.action).toBe("deny");
    expect(get("mcp")?.action).toBe("ask");
    expect(get("skill")?.action).toBe("allow");
    expect(get("special")?.action).toBe("deny");
  });

  test("default rules catch any surface via the universal '*' entry", () => {
    const rules = synthesizeDefaults(ALL_ASK);
    // A brand-new surface "future_tool" should be caught by the universal rule.
    const result = evaluate("future_tool", "*", rules);
    expect(result.action).toBe("ask");
    expect(result.layer).toBe("default");
  });

  test("specific surface default beats universal default (last-match-wins)", () => {
    const mixed: PermissionDefaultPolicy = {
      tools: "allow",
      bash: "deny",
      mcp: "ask",
      skills: "ask",
      special: "ask",
    };
    const rules = synthesizeDefaults(mixed);
    // For bash, the specific bash rule (later in array) beats the universal rule.
    const result = evaluate("bash", "git status", rules);
    expect(result.action).toBe("deny");
    expect(result.layer).toBe("default");
  });
});

// ── synthesizeOverrides ────────────────────────────────────────────────────

describe("synthesizeOverrides", () => {
  test("returns empty ruleset for empty input", () => {
    expect(synthesizeOverrides([])).toEqual([]);
  });

  test("returns empty ruleset when no scope has overrides", () => {
    expect(synthesizeOverrides([{}, {}, {}])).toEqual([]);
  });

  test("emits a bash override rule for each scope that defines tools.bash", () => {
    const rules = synthesizeOverrides([{ bash: "allow" }]);
    expect(rules).toEqual([
      { surface: "bash", pattern: "*", action: "allow", layer: "override" },
    ]);
  });

  test("emits an mcp override rule for each scope that defines tools.mcp", () => {
    const rules = synthesizeOverrides([{ mcp: "deny" }]);
    expect(rules).toEqual([
      { surface: "mcp", pattern: "*", action: "deny", layer: "override" },
    ]);
  });

  test("emits both bash and mcp override rules when both are defined in a scope", () => {
    const rules = synthesizeOverrides([{ bash: "allow", mcp: "deny" }]);
    expect(rules).toHaveLength(2);
    const bash = rules.find((r) => r.surface === "bash");
    const mcp = rules.find((r) => r.surface === "mcp");
    expect(bash?.action).toBe("allow");
    expect(mcp?.action).toBe("deny");
  });

  test("later scopes produce later rules (higher priority via last-match-wins)", () => {
    const rules = synthesizeOverrides([{ bash: "deny" }, { bash: "allow" }]);
    const result = evaluate("bash", "git status", rules);
    expect(result.action).toBe("allow"); // later scope wins
  });

  test("skips undefined fields and emits nothing for them", () => {
    const rules = synthesizeOverrides([
      { bash: undefined, mcp: "allow" },
      { bash: "deny", mcp: undefined },
    ]);
    const bashRules = rules.filter((r) => r.surface === "bash");
    const mcpRules = rules.filter((r) => r.surface === "mcp");
    expect(bashRules).toHaveLength(1);
    expect(mcpRules).toHaveLength(1);
    expect(bashRules[0].action).toBe("deny");
    expect(mcpRules[0].action).toBe("allow");
  });

  test("override rules all have layer 'override'", () => {
    const rules = synthesizeOverrides([
      { bash: "allow", mcp: "deny" },
      { bash: "deny" },
    ]);
    for (const rule of rules) {
      expect(rule.layer).toBe("override");
    }
  });
});

// ── synthesizeBaseline ─────────────────────────────────────────────────────

describe("synthesizeBaseline", () => {
  test("returns empty ruleset when config has no mcp allow rules", () => {
    const configRules = [
      {
        surface: "mcp",
        pattern: "*",
        action: "deny" as const,
        layer: "config" as const,
      },
    ];
    expect(synthesizeBaseline(configRules)).toEqual([]);
  });

  test("returns empty ruleset for empty config rules", () => {
    expect(synthesizeBaseline([])).toEqual([]);
  });

  test("synthesizes 5 baseline rules when at least one mcp allow config rule exists", () => {
    const configRules = [
      {
        surface: "mcp",
        pattern: "exa:*",
        action: "allow" as const,
        layer: "config" as const,
      },
    ];
    const rules = synthesizeBaseline(configRules);
    expect(rules).toHaveLength(5);
  });

  test("baseline rules all have layer 'baseline' and action 'allow'", () => {
    const configRules = [
      {
        surface: "mcp",
        pattern: "exa:*",
        action: "allow" as const,
        layer: "config" as const,
      },
    ];
    const rules = synthesizeBaseline(configRules);
    for (const rule of rules) {
      expect(rule.layer).toBe("baseline");
      expect(rule.action).toBe("allow");
      expect(rule.surface).toBe("mcp");
    }
  });

  test("baseline rules cover the 5 MCP metadata targets", () => {
    const configRules = [
      {
        surface: "mcp",
        pattern: "exa:*",
        action: "allow" as const,
        layer: "config" as const,
      },
    ];
    const rules = synthesizeBaseline(configRules);
    const patterns = rules.map((r) => r.pattern);
    expect(patterns).toContain("mcp_status");
    expect(patterns).toContain("mcp_list");
    expect(patterns).toContain("mcp_search");
    expect(patterns).toContain("mcp_describe");
    expect(patterns).toContain("mcp_connect");
  });

  test("baseline is NOT synthesized when allow rule is on a non-mcp surface", () => {
    const configRules = [
      {
        surface: "bash",
        pattern: "git *",
        action: "allow" as const,
        layer: "config" as const,
      },
    ];
    expect(synthesizeBaseline(configRules)).toEqual([]);
  });

  test("baseline is NOT synthesized when defaults.mcp === 'allow' but no config allow rules", () => {
    // defaults.mcp === 'allow' is handled by the synthesized default catch-all, not baseline.
    const configRules = [
      {
        surface: "mcp",
        pattern: "*",
        action: "deny" as const,
        layer: "config" as const,
      },
    ];
    expect(synthesizeBaseline(configRules)).toEqual([]);
  });

  test("baseline auto-allows mcp_status when an mcp allow rule exists", () => {
    const configRules = [
      {
        surface: "mcp",
        pattern: "exa:*",
        action: "allow" as const,
        layer: "config" as const,
      },
    ];
    const rules = synthesizeBaseline(configRules);
    const result = evaluate("mcp", "mcp_status", rules);
    expect(result.action).toBe("allow");
    expect(result.layer).toBe("baseline");
  });
});

// ── composeRuleset ─────────────────────────────────────────────────────────

describe("composeRuleset", () => {
  test("returns concatenation of all layers in order", () => {
    const defaults = synthesizeDefaults(ALL_ASK);
    const baseline = synthesizeBaseline([
      { surface: "mcp", pattern: "exa:*", action: "allow", layer: "config" },
    ]);
    const overrides = synthesizeOverrides([{ bash: "allow" }]);
    const config = [
      { surface: "bash", pattern: "rm -rf *", action: "deny" as const },
    ];
    const composed = composeRuleset(defaults, baseline, overrides, config);
    expect(composed.length).toBe(
      defaults.length + baseline.length + overrides.length + config.length,
    );
  });

  test("defaults come first (lowest priority), config comes last (highest priority)", () => {
    const defaults = [
      {
        surface: "bash",
        pattern: "*",
        action: "ask" as const,
        layer: "default" as const,
      },
    ];
    const baseline: never[] = [];
    const overrides = [
      {
        surface: "bash",
        pattern: "*",
        action: "allow" as const,
        layer: "override" as const,
      },
    ];
    const config = [
      {
        surface: "bash",
        pattern: "*",
        action: "deny" as const,
        layer: "config" as const,
      },
    ];
    const composed = composeRuleset(defaults, baseline, overrides, config);
    // Last-match-wins: config is last → deny wins for any bash command.
    const result = evaluate("bash", "echo hello", composed);
    expect(result.action).toBe("deny");
    expect(result.layer).toBe("config");
  });

  test("override beats default when no config rule exists", () => {
    const defaults = [
      {
        surface: "bash",
        pattern: "*",
        action: "ask" as const,
        layer: "default" as const,
      },
    ];
    const overrides = [
      {
        surface: "bash",
        pattern: "*",
        action: "allow" as const,
        layer: "override" as const,
      },
    ];
    const composed = composeRuleset(defaults, [], overrides, []);
    const result = evaluate("bash", "echo hello", composed);
    expect(result.action).toBe("allow");
    expect(result.layer).toBe("override");
  });

  test("baseline beats default but override beats baseline", () => {
    const defaults = [
      {
        surface: "mcp",
        pattern: "*",
        action: "ask" as const,
        layer: "default" as const,
      },
    ];
    const baseline = [
      {
        surface: "mcp",
        pattern: "mcp_status",
        action: "allow" as const,
        layer: "baseline" as const,
      },
    ];
    const overrides = [
      {
        surface: "mcp",
        pattern: "*",
        action: "deny" as const,
        layer: "override" as const,
      },
    ];
    const composed = composeRuleset(defaults, baseline, overrides, []);
    // override beats baseline for mcp_status
    const result = evaluate("mcp", "mcp_status", composed);
    expect(result.action).toBe("deny");
    expect(result.layer).toBe("override");
  });

  test("config beats override for specific patterns", () => {
    const overrides = [
      {
        surface: "mcp",
        pattern: "*",
        action: "deny" as const,
        layer: "override" as const,
      },
    ];
    const config = [
      {
        surface: "mcp",
        pattern: "exa_web_search",
        action: "allow" as const,
        layer: "config" as const,
      },
    ];
    const composed = composeRuleset([], [], overrides, config);
    const result = evaluate("mcp", "exa_web_search", composed);
    expect(result.action).toBe("allow");
    expect(result.layer).toBe("config");
  });

  test("handles empty layers gracefully", () => {
    const defaults = synthesizeDefaults(ALL_ASK);
    const composed = composeRuleset(defaults, [], [], []);
    expect(composed).toEqual(defaults);
  });
});
