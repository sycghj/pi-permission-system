import { describe, expect, test } from "vitest";
import {
  DEFAULT_POLICY,
  getSurfaceDefault,
  mergeDefaults,
} from "../src/defaults";
import type { PermissionDefaultPolicy } from "../src/types";

const SPECIAL_KEYS = new Set(["external_directory"]);

describe("getSurfaceDefault", () => {
  const defaults: PermissionDefaultPolicy = {
    tools: "allow",
    bash: "deny",
    mcp: "ask",
    skills: "allow",
    special: "deny",
  };

  test("returns defaults.bash for surface 'bash'", () => {
    expect(getSurfaceDefault("bash", defaults, SPECIAL_KEYS)).toBe("deny");
  });

  test("returns defaults.mcp for surface 'mcp'", () => {
    expect(getSurfaceDefault("mcp", defaults, SPECIAL_KEYS)).toBe("ask");
  });

  test("returns defaults.skills for surface 'skill'", () => {
    expect(getSurfaceDefault("skill", defaults, SPECIAL_KEYS)).toBe("allow");
  });

  test("returns defaults.special for special-key surfaces", () => {
    expect(
      getSurfaceDefault("external_directory", defaults, SPECIAL_KEYS),
    ).toBe("deny");
  });

  test("returns defaults.tools for tool-name surfaces", () => {
    expect(getSurfaceDefault("read", defaults, SPECIAL_KEYS)).toBe("allow");
    expect(getSurfaceDefault("write", defaults, SPECIAL_KEYS)).toBe("allow");
    expect(getSurfaceDefault("edit", defaults, SPECIAL_KEYS)).toBe("allow");
  });

  test("returns defaults.tools for unknown surfaces (least privilege via tools default)", () => {
    expect(
      getSurfaceDefault("unknown_extension_tool", defaults, SPECIAL_KEYS),
    ).toBe("allow");
  });

  test("uses DEFAULT_POLICY when no overrides exist", () => {
    expect(getSurfaceDefault("bash", DEFAULT_POLICY, SPECIAL_KEYS)).toBe("ask");
    expect(getSurfaceDefault("read", DEFAULT_POLICY, SPECIAL_KEYS)).toBe("ask");
    expect(
      getSurfaceDefault("external_directory", DEFAULT_POLICY, SPECIAL_KEYS),
    ).toBe("ask");
  });
});

describe("mergeDefaults", () => {
  test("returns DEFAULT_POLICY when called with no partials", () => {
    expect(mergeDefaults()).toEqual(DEFAULT_POLICY);
  });

  test("overrides specific fields from a single partial", () => {
    const result = mergeDefaults({ tools: "allow", bash: "deny" });
    expect(result).toEqual({
      tools: "allow",
      bash: "deny",
      mcp: "ask",
      skills: "ask",
      special: "ask",
    });
  });

  test("later partials override earlier ones", () => {
    const global: Partial<PermissionDefaultPolicy> = { tools: "allow" };
    const project: Partial<PermissionDefaultPolicy> = { tools: "deny" };
    const result = mergeDefaults(global, project);
    expect(result.tools).toBe("deny");
  });

  test("merges across multiple partials", () => {
    const global: Partial<PermissionDefaultPolicy> = {
      tools: "allow",
      bash: "allow",
    };
    const project: Partial<PermissionDefaultPolicy> = { bash: "deny" };
    const agent: Partial<PermissionDefaultPolicy> = { mcp: "allow" };
    const result = mergeDefaults(global, project, agent);
    expect(result).toEqual({
      tools: "allow",
      bash: "deny",
      mcp: "allow",
      skills: "ask",
      special: "ask",
    });
  });

  test("undefined fields in later partials do not override earlier values", () => {
    const global: Partial<PermissionDefaultPolicy> = { tools: "allow" };
    const project: Partial<PermissionDefaultPolicy> = { bash: "deny" };
    const result = mergeDefaults(global, project);
    expect(result.tools).toBe("allow");
  });
});
