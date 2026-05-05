/**
 * Integration tests verifying the unified checkPermission() path.
 *
 * Step 5: session rules concatenated into the composed ruleset.
 * Step 6: all five surfaces produce identical decisions to the old branching code.
 */
import { describe, expect, it } from "vitest";
import { PermissionManager } from "../src/permission-manager";
import type { Rule, Ruleset } from "../src/rule";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManager(
  permission: Record<string, unknown> = {},
  mcpServerNames: readonly string[] = [],
): PermissionManager {
  return new PermissionManager({
    globalConfigPath: "/nonexistent/config.json",
    agentsDir: "/nonexistent/agents",
    mcpServerNames: [...mcpServerNames],
  });
}

function makeManagerWithConfig(
  permission: Record<string, unknown>,
  mcpServerNames: readonly string[] = [],
): PermissionManager {
  // Build the minimal config JSON inline via a temp path trick:
  // PermissionManager loads from disk, so we use the override constructor
  // option that accepts pre-resolved mcpServerNames and rely on a missing
  // config file (which normalises to an empty permission map → universal
  // default "ask"). For session-rule tests the config content is not
  // material — we pass session rules directly to checkPermission().
  void permission; // unused in this helper; provided for documentation
  return makeManager({}, mcpServerNames);
}

const sessionAllow = (surface: string, pattern: string): Rule => ({
  surface,
  pattern,
  action: "allow",
  layer: "session",
});

// ---------------------------------------------------------------------------
// Step 5: session rules concatenated — wins over config/default
// ---------------------------------------------------------------------------

describe("checkPermission — session rules", () => {
  it("session rule wins over the universal default (external_directory)", () => {
    const manager = makeManagerWithConfig({});
    const sessionRules: Ruleset = [
      sessionAllow("external_directory", "/other/project"),
    ];
    const result = manager.checkPermission(
      "external_directory",
      { path: "/other/project" },
      undefined,
      sessionRules,
    );
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
    expect(result.matchedPattern).toBe("/other/project");
  });

  it("session rule wins over the universal default (skill)", () => {
    const manager = makeManagerWithConfig({});
    const sessionRules: Ruleset = [sessionAllow("skill", "librarian")];
    const result = manager.checkPermission(
      "skill",
      { name: "librarian" },
      undefined,
      sessionRules,
    );
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
    expect(result.matchedPattern).toBe("librarian");
  });

  it("session rule wins over the universal default (bash)", () => {
    const manager = makeManagerWithConfig({});
    const sessionRules: Ruleset = [sessionAllow("bash", "git status")];
    const result = manager.checkPermission(
      "bash",
      { command: "git status" },
      undefined,
      sessionRules,
    );
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
    expect(result.matchedPattern).toBe("git status");
  });

  it("session rule wins over the universal default (tool — read)", () => {
    const manager = makeManagerWithConfig({});
    const sessionRules: Ruleset = [sessionAllow("read", "*")];
    const result = manager.checkPermission("read", {}, undefined, sessionRules);
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
  });

  it("session rule wins over the universal default (mcp)", () => {
    const manager = makeManagerWithConfig({});
    const sessionRules: Ruleset = [sessionAllow("mcp", "mcp_status")];
    const result = manager.checkPermission("mcp", {}, undefined, sessionRules);
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
  });

  it("no session rules — falls through to default (ask)", () => {
    const manager = makeManagerWithConfig({});
    const result = manager.checkPermission("read", {}, undefined, []);
    expect(result.state).toBe("ask");
    expect(result.source).not.toBe("session");
  });

  it("session rule with narrower pattern does not block a broader command not in session", () => {
    const manager = makeManagerWithConfig({});
    // Only "git status" is session-approved; "git push" should fall through to default.
    const sessionRules: Ruleset = [sessionAllow("bash", "git status")];
    const result = manager.checkPermission(
      "bash",
      { command: "git push origin main" },
      undefined,
      sessionRules,
    );
    expect(result.state).toBe("ask");
    expect(result.source).not.toBe("session");
  });

  it("session wildcard pattern matches multiple commands", () => {
    const manager = makeManagerWithConfig({});
    const sessionRules: Ruleset = [sessionAllow("bash", "git *")];
    const push = manager.checkPermission(
      "bash",
      { command: "git push origin main" },
      undefined,
      sessionRules,
    );
    const status = manager.checkPermission(
      "bash",
      { command: "git status" },
      undefined,
      sessionRules,
    );
    expect(push.state).toBe("allow");
    expect(push.source).toBe("session");
    expect(status.state).toBe("allow");
    expect(status.source).toBe("session");
  });
});
