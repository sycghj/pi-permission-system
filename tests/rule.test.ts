import { afterEach, describe, expect, test, vi } from "vitest";
import type { Rule, Ruleset } from "../src/rule";
import { evaluate, getDefaultAction } from "../src/rule";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getDefaultAction", () => {
  test("returns 'ask' for bash surface", () => {
    expect(getDefaultAction("bash")).toBe("ask");
  });

  test("returns 'ask' for mcp surface", () => {
    expect(getDefaultAction("mcp")).toBe("ask");
  });

  test("returns 'ask' for skill surface", () => {
    expect(getDefaultAction("skill")).toBe("ask");
  });

  test("returns 'ask' for special surface", () => {
    expect(getDefaultAction("special")).toBe("ask");
  });

  test("returns 'ask' for tools surface", () => {
    expect(getDefaultAction("tools")).toBe("ask");
  });

  test("returns 'ask' for unknown surface (least privilege)", () => {
    expect(getDefaultAction("unknown_surface")).toBe("ask");
    expect(getDefaultAction("")).toBe("ask");
    expect(getDefaultAction("external_directory")).toBe("ask");
  });
});

describe("evaluate", () => {
  const allowBashGit: Rule = {
    surface: "bash",
    pattern: "git *",
    action: "allow",
  };
  const denyBashGitPush: Rule = {
    surface: "bash",
    pattern: "git push *",
    action: "deny",
  };
  const allowRead: Rule = { surface: "read", pattern: "*", action: "allow" };
  const askMcp: Rule = { surface: "mcp", pattern: "*", action: "ask" };
  const allowSkillLibrarian: Rule = {
    surface: "skill",
    pattern: "librarian",
    action: "allow",
  };
  const askSpecialExtDir: Rule = {
    surface: "special",
    pattern: "external_directory",
    action: "ask",
  };

  test("returns matching rule when a rule matches", () => {
    const ruleset: Ruleset = [allowBashGit];
    const result = evaluate("bash", "git status", ruleset);
    expect(result).toEqual(allowBashGit);
  });

  test("returns synthetic rule with default action when no rules match", () => {
    const result = evaluate("bash", "npm install", [allowBashGit]);
    expect(result.surface).toBe("bash");
    expect(result.pattern).toBe("npm install");
    expect(result.action).toBe("ask"); // getDefaultAction("bash")
  });

  test("returns synthetic rule for empty ruleset", () => {
    const result = evaluate("mcp", "exa_search", []);
    expect(result.surface).toBe("mcp");
    expect(result.pattern).toBe("exa_search");
    expect(result.action).toBe("ask");
  });

  test("matches rules for all permission surfaces", () => {
    expect(evaluate("read", "src/foo.ts", [allowRead]).action).toBe("allow");
    expect(evaluate("mcp", "exa_search", [askMcp]).action).toBe("ask");
    expect(evaluate("skill", "librarian", [allowSkillLibrarian]).action).toBe(
      "allow",
    );
    expect(
      evaluate("special", "external_directory", [askSpecialExtDir]).action,
    ).toBe("ask");
  });

  test("last-match-wins: later conflicting rule overrides earlier", () => {
    const ruleset: Ruleset = [allowBashGit, denyBashGitPush];
    const result = evaluate("bash", "git push origin main", ruleset);
    expect(result).toEqual(denyBashGitPush);
  });

  test("last-match-wins: broad deny followed by specific allow", () => {
    const denyAll: Rule = { surface: "bash", pattern: "*", action: "deny" };
    const allowStatus: Rule = {
      surface: "bash",
      pattern: "git status",
      action: "allow",
    };
    const result = evaluate("bash", "git status", [denyAll, allowStatus]);
    expect(result).toEqual(allowStatus);
  });

  test("wildcard surface in rule matches any surface value", () => {
    const universalAllow: Rule = {
      surface: "*",
      pattern: "*",
      action: "allow",
    };
    expect(evaluate("bash", "anything", [universalAllow]).action).toBe("allow");
    expect(evaluate("mcp", "something", [universalAllow]).action).toBe("allow");
    expect(evaluate("skill", "librarian", [universalAllow]).action).toBe(
      "allow",
    );
  });

  test("specific surface rule does not match a different surface", () => {
    const ruleset: Ruleset = [allowBashGit];
    // bash rule should not match mcp surface
    const result = evaluate("mcp", "git status", ruleset);
    expect(result.action).toBe("ask"); // falls back to default
  });

  test("multiple rulesets: rules from later rulesets take priority", () => {
    const globalRules: Ruleset = [
      { surface: "bash", pattern: "git *", action: "ask" },
    ];
    const agentRules: Ruleset = [
      { surface: "bash", pattern: "git *", action: "allow" },
    ];
    const result = evaluate("bash", "git status", globalRules, agentRules);
    expect(result.action).toBe("allow"); // agent rule wins
  });

  test("multiple rulesets: earlier rulesets used when later rulesets have no match", () => {
    const globalRules: Ruleset = [
      { surface: "bash", pattern: "git *", action: "allow" },
    ];
    const agentRules: Ruleset = [
      { surface: "bash", pattern: "npm *", action: "deny" },
    ];
    // git status matches global but not agent rule
    const result = evaluate("bash", "git status", globalRules, agentRules);
    expect(result.action).toBe("allow"); // global rule is the last match for this pattern
  });

  test("no rulesets at all returns synthetic default", () => {
    const result = evaluate("bash", "git status");
    expect(result.surface).toBe("bash");
    expect(result.pattern).toBe("git status");
    expect(result.action).toBe("ask");
  });
});
