import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FilePolicyLoader } from "../src/policy-loader";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "policy-loader-test-"));
}

function makeLoader(
  baseDir: string,
  options: {
    globalConfig?: Record<string, unknown>;
    mcpServerNames?: readonly string[];
  } = {},
) {
  const agentsDir = join(baseDir, "agents");
  mkdirSync(agentsDir, { recursive: true });

  const globalConfigPath = join(baseDir, "config.json");
  writeFileSync(
    globalConfigPath,
    JSON.stringify(options.globalConfig ?? {}, null, 2),
  );

  return new FilePolicyLoader({
    globalConfigPath,
    agentsDir,
    mcpServerNames: options.mcpServerNames
      ? [...options.mcpServerNames]
      : undefined,
  });
}

// ---------------------------------------------------------------------------
// loadGlobalConfig
// ---------------------------------------------------------------------------

describe("FilePolicyLoader.loadGlobalConfig", () => {
  it("returns ScopeConfig with permission from a valid config file", () => {
    const baseDir = makeTempDir();
    try {
      const loader = makeLoader(baseDir, {
        globalConfig: { permission: { "*": "allow", read: "ask" } },
      });
      const config = loader.loadGlobalConfig();
      expect(config.permission).toEqual({ "*": "allow", read: "ask" });
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("returns empty ScopeConfig when config file is missing", () => {
    const loader = new FilePolicyLoader({
      globalConfigPath: "/nonexistent/config.json",
      agentsDir: "/nonexistent/agents",
    });
    const config = loader.loadGlobalConfig();
    expect(config.permission).toBeUndefined();
  });

  it("returns empty ScopeConfig when config file has no permission key", () => {
    const baseDir = makeTempDir();
    try {
      const loader = makeLoader(baseDir, {
        globalConfig: { debugLog: true },
      });
      const config = loader.loadGlobalConfig();
      expect(config.permission).toBeUndefined();
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// loadProjectConfig
// ---------------------------------------------------------------------------

describe("FilePolicyLoader.loadProjectConfig", () => {
  it("returns empty ScopeConfig when no project path is configured", () => {
    const loader = new FilePolicyLoader({
      globalConfigPath: "/nonexistent/config.json",
      agentsDir: "/nonexistent/agents",
    });
    const config = loader.loadProjectConfig();
    expect(config).toEqual({});
  });

  it("returns ScopeConfig from a project config file", () => {
    const baseDir = makeTempDir();
    try {
      const projectConfigPath = join(baseDir, "project-config.json");
      writeFileSync(
        projectConfigPath,
        JSON.stringify({ permission: { bash: "allow" } }),
      );
      const loader = new FilePolicyLoader({
        globalConfigPath: "/nonexistent/config.json",
        agentsDir: "/nonexistent/agents",
        projectGlobalConfigPath: projectConfigPath,
      });
      const config = loader.loadProjectConfig();
      expect(config.permission).toEqual({ bash: "allow" });
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// loadAgentConfig / loadProjectAgentConfig
// ---------------------------------------------------------------------------

describe("FilePolicyLoader.loadAgentConfig", () => {
  it("returns empty ScopeConfig when agentName is undefined", () => {
    const baseDir = makeTempDir();
    try {
      const loader = makeLoader(baseDir);
      expect(loader.loadAgentConfig()).toEqual({});
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("returns ScopeConfig from agent frontmatter", () => {
    const baseDir = makeTempDir();
    try {
      const agentsDir = join(baseDir, "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, "coder.md"),
        `---\npermission:\n  bash: allow\n---\n# Coder agent\n`,
      );
      const loader = new FilePolicyLoader({
        globalConfigPath: join(baseDir, "config.json"),
        agentsDir,
      });
      writeFileSync(join(baseDir, "config.json"), "{}");
      const config = loader.loadAgentConfig("coder");
      expect(config.permission).toEqual({ bash: "allow" });
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("returns empty ScopeConfig when agent file does not exist", () => {
    const baseDir = makeTempDir();
    try {
      const loader = makeLoader(baseDir);
      expect(loader.loadAgentConfig("nonexistent")).toEqual({});
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe("FilePolicyLoader.loadProjectAgentConfig", () => {
  it("returns empty ScopeConfig when no projectAgentsDir is configured", () => {
    const baseDir = makeTempDir();
    try {
      const loader = makeLoader(baseDir);
      expect(loader.loadProjectAgentConfig("coder")).toEqual({});
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// getConfigIssues
// ---------------------------------------------------------------------------

describe("FilePolicyLoader.getConfigIssues", () => {
  it("returns empty array before any loads", () => {
    const loader = new FilePolicyLoader({
      globalConfigPath: "/nonexistent/config.json",
      agentsDir: "/nonexistent/agents",
    });
    expect(loader.getConfigIssues()).toEqual([]);
  });

  it("returns empty array for valid config", () => {
    const baseDir = makeTempDir();
    try {
      const loader = makeLoader(baseDir, {
        globalConfig: { permission: { "*": "ask" } },
      });
      loader.loadGlobalConfig();
      expect(loader.getConfigIssues()).toEqual([]);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// getResolvedPolicyPaths
// ---------------------------------------------------------------------------

describe("FilePolicyLoader.getResolvedPolicyPaths", () => {
  it("returns correct paths and existence when files exist", () => {
    const baseDir = makeTempDir();
    try {
      const globalConfigPath = join(baseDir, "config.json");
      const agentsDir = join(baseDir, "agents");
      writeFileSync(globalConfigPath, "{}");
      mkdirSync(agentsDir, { recursive: true });

      const loader = new FilePolicyLoader({ globalConfigPath, agentsDir });
      const paths = loader.getResolvedPolicyPaths();

      expect(paths.globalConfigPath).toBe(globalConfigPath);
      expect(paths.globalConfigExists).toBe(true);
      expect(paths.agentsDir).toBe(agentsDir);
      expect(paths.agentsDirExists).toBe(true);
      expect(paths.projectConfigPath).toBeNull();
      expect(paths.projectConfigExists).toBe(false);
      expect(paths.projectAgentsDir).toBeNull();
      expect(paths.projectAgentsDirExists).toBe(false);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// getCacheStamp
// ---------------------------------------------------------------------------

describe("FilePolicyLoader.getCacheStamp", () => {
  it("returns a string stamp", () => {
    const loader = new FilePolicyLoader({
      globalConfigPath: "/nonexistent/config.json",
      agentsDir: "/nonexistent/agents",
    });
    const stamp = loader.getCacheStamp();
    expect(typeof stamp).toBe("string");
    expect(stamp.length).toBeGreaterThan(0);
  });

  it("changes when the global config file changes", () => {
    const baseDir = makeTempDir();
    try {
      const globalConfigPath = join(baseDir, "config.json");
      writeFileSync(globalConfigPath, "{}");
      const agentsDir = join(baseDir, "agents");
      mkdirSync(agentsDir, { recursive: true });

      const loader = new FilePolicyLoader({ globalConfigPath, agentsDir });
      const stamp1 = loader.getCacheStamp();

      // Wait a tick so mtime changes
      const now = Date.now();
      while (Date.now() - now < 50) {
        // busy-wait for mtime resolution
      }
      writeFileSync(globalConfigPath, '{"permission": {}}');
      const stamp2 = loader.getCacheStamp();

      expect(stamp1).not.toBe(stamp2);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
