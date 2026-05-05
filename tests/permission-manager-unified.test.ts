/**
 * Integration tests verifying the unified checkPermission() path.
 *
 * Step 5: session rules concatenated into the composed ruleset.
 * Step 6: all five surfaces produce identical decisions to the old branching code.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PermissionManager } from "../src/permission-manager";
import type { Rule, Ruleset } from "../src/rule";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Manager backed by a missing config file — universal default is "ask". */
function makeManager(
  mcpServerNames: readonly string[] = [],
): PermissionManager {
  return new PermissionManager({
    globalConfigPath: "/nonexistent/config.json",
    agentsDir: "/nonexistent/agents",
    mcpServerNames: [...mcpServerNames],
  });
}

/**
 * Manager backed by a real on-disk config file written to a temp directory.
 * Returns the manager and a cleanup function.
 */
function makeManagerWithConfig(
  permission: Record<string, unknown>,
  mcpServerNames: readonly string[] = [],
): { manager: PermissionManager; cleanup: () => void } {
  const baseDir = mkdtempSync(join(tmpdir(), "pm-unified-test-"));
  const agentsDir = join(baseDir, "agents");
  mkdirSync(agentsDir, { recursive: true });
  const globalConfigPath = join(baseDir, "config.json");
  writeFileSync(globalConfigPath, JSON.stringify({ permission }, null, 2));
  const manager = new PermissionManager({
    globalConfigPath,
    agentsDir,
    mcpServerNames: [...mcpServerNames],
  });
  return {
    manager,
    cleanup: () => rmSync(baseDir, { recursive: true, force: true }),
  };
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
    const manager = makeManager();
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
    const manager = makeManager();
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
    const manager = makeManager();
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
    const manager = makeManager();
    const sessionRules: Ruleset = [sessionAllow("read", "*")];
    const result = manager.checkPermission("read", {}, undefined, sessionRules);
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
  });

  it("session rule wins over the universal default (mcp)", () => {
    const manager = makeManager();
    const sessionRules: Ruleset = [sessionAllow("mcp", "mcp_status")];
    const result = manager.checkPermission("mcp", {}, undefined, sessionRules);
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
  });

  it("no session rules — falls through to default (ask)", () => {
    const manager = makeManager();
    const result = manager.checkPermission("read", {}, undefined, []);
    expect(result.state).toBe("ask");
    expect(result.source).not.toBe("session");
  });

  it("session rule with narrower pattern does not block a broader command not in session", () => {
    const manager = makeManager();
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
    const manager = makeManager();
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

// ---------------------------------------------------------------------------
// Step 6: source field and matchedPattern for all five surfaces
// ---------------------------------------------------------------------------

describe("checkPermission — source derivation and matchedPattern", () => {
  describe("external_directory (special surface)", () => {
    it("source is 'special' for a config-matched path", () => {
      const { manager, cleanup } = makeManagerWithConfig({
        "*": "ask",
        external_directory: { "/trusted/*": "allow" },
      });
      try {
        const result = manager.checkPermission("external_directory", {
          path: "/trusted/repo",
        });
        expect(result.state).toBe("allow");
        expect(result.source).toBe("special");
        expect(result.matchedPattern).toBe("/trusted/*");
      } finally {
        cleanup();
      }
    });

    it("source is 'special' even for a default match (no config rule)", () => {
      const manager = makeManager();
      const result = manager.checkPermission("external_directory", {
        path: "/some/path",
      });
      expect(result.state).toBe("ask");
      expect(result.source).toBe("special");
      expect(result.matchedPattern).toBeUndefined();
    });

    it("matchedPattern is undefined for a default match", () => {
      const manager = makeManager();
      const result = manager.checkPermission("external_directory", {
        path: "/unknown",
      });
      expect(result.matchedPattern).toBeUndefined();
    });
  });

  describe("skill surface", () => {
    it("source is 'skill' for a config-matched skill name", () => {
      const { manager, cleanup } = makeManagerWithConfig({
        "*": "ask",
        skill: { librarian: "allow" },
      });
      try {
        const result = manager.checkPermission("skill", { name: "librarian" });
        expect(result.state).toBe("allow");
        expect(result.source).toBe("skill");
        expect(result.matchedPattern).toBe("librarian");
      } finally {
        cleanup();
      }
    });

    it("source is 'skill' even for a default match", () => {
      const manager = makeManager();
      const result = manager.checkPermission("skill", { name: "unknown" });
      expect(result.state).toBe("ask");
      expect(result.source).toBe("skill");
    });
  });

  describe("bash surface", () => {
    it("source is 'bash' and command is included in result", () => {
      const { manager, cleanup } = makeManagerWithConfig({
        "*": "ask",
        bash: { "git *": "allow" },
      });
      try {
        const result = manager.checkPermission("bash", {
          command: "git status",
        });
        expect(result.state).toBe("allow");
        expect(result.source).toBe("bash");
        expect(result.command).toBe("git status");
        expect(result.matchedPattern).toBe("git *");
      } finally {
        cleanup();
      }
    });

    it("source is 'bash' even for a default match, command is empty string", () => {
      const manager = makeManager();
      const result = manager.checkPermission("bash", {});
      expect(result.source).toBe("bash");
      expect(result.command).toBe("");
      expect(result.matchedPattern).toBeUndefined();
    });
  });

  describe("mcp surface", () => {
    it("source is 'mcp' for a config-matched target", () => {
      const { manager, cleanup } = makeManagerWithConfig(
        { "*": "ask", mcp: { exa_search: "allow" } },
        ["exa"],
      );
      try {
        const result = manager.checkPermission("mcp", {
          tool: "exa:search",
          server: "exa",
        });
        expect(result.state).toBe("allow");
        expect(result.source).toBe("mcp");
        expect(result.matchedPattern).toBe("exa_search");
        expect(result.target).toBeDefined();
      } finally {
        cleanup();
      }
    });

    it("source is 'default' when all targets match only the synthesized default", () => {
      const manager = makeManager();
      const result = manager.checkPermission("mcp", { tool: "exa:search" });
      expect(result.state).toBe("ask");
      expect(result.source).toBe("default");
      expect(result.matchedPattern).toBeUndefined();
    });

    it("target field is set for a matched mcp call", () => {
      const { manager, cleanup } = makeManagerWithConfig(
        { "*": "ask", mcp: { mcp_status: "allow" } },
        [],
      );
      try {
        const result = manager.checkPermission("mcp", {});
        expect(result.target).toBeDefined();
        expect(result.source).toBe("mcp");
      } finally {
        cleanup();
      }
    });
  });

  describe("tool surfaces", () => {
    it("built-in tool: source is always 'tool' (config match)", () => {
      const { manager, cleanup } = makeManagerWithConfig({
        "*": "ask",
        read: "allow",
      });
      try {
        const result = manager.checkPermission("read", {});
        expect(result.state).toBe("allow");
        expect(result.source).toBe("tool");
      } finally {
        cleanup();
      }
    });

    it("built-in tool: source is 'tool' even for a default match", () => {
      const manager = makeManager();
      const result = manager.checkPermission("read", {});
      expect(result.state).toBe("ask");
      expect(result.source).toBe("tool");
    });

    it("extension tool: source is 'default' when no config rule matches", () => {
      const manager = makeManager();
      const result = manager.checkPermission("my_custom_tool", {});
      expect(result.state).toBe("ask");
      expect(result.source).toBe("default");
    });

    it("extension tool: source is 'tool' when a config rule matches", () => {
      const { manager, cleanup } = makeManagerWithConfig({
        "*": "ask",
        my_custom_tool: "allow",
      });
      try {
        const result = manager.checkPermission("my_custom_tool", {});
        expect(result.state).toBe("allow");
        expect(result.source).toBe("tool");
      } finally {
        cleanup();
      }
    });
  });

  describe("matchedPattern for session rules across surfaces", () => {
    it("matchedPattern is the session rule pattern for a session match (bash)", () => {
      const manager = makeManager();
      const sessionRules: Ruleset = [sessionAllow("bash", "git *")];
      const result = manager.checkPermission(
        "bash",
        { command: "git status" },
        undefined,
        sessionRules,
      );
      expect(result.matchedPattern).toBe("git *");
      expect(result.source).toBe("session");
    });

    it("matchedPattern is the session rule pattern for a session match (skill)", () => {
      const manager = makeManager();
      const sessionRules: Ruleset = [sessionAllow("skill", "librarian")];
      const result = manager.checkPermission(
        "skill",
        { name: "librarian" },
        undefined,
        sessionRules,
      );
      expect(result.matchedPattern).toBe("librarian");
    });
  });
});
