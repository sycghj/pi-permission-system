import { describe, expect, test } from "vitest";
import { normalizeConfig } from "../src/normalize";

describe("normalizeConfig", () => {
  describe("tools entries", () => {
    test("converts tools entries to tool-name-as-surface rules", () => {
      const result = normalizeConfig({
        tools: { read: "allow", write: "deny" },
      });
      expect(result).toEqual([
        { surface: "read", pattern: "*", action: "allow" },
        { surface: "write", pattern: "*", action: "deny" },
      ]);
    });

    test("tools.bash is excluded (handled as fallback override)", () => {
      const result = normalizeConfig({
        tools: { bash: "allow", read: "allow" },
      });
      expect(result).toEqual([
        { surface: "read", pattern: "*", action: "allow" },
      ]);
    });

    test("tools.mcp is excluded (handled as fallback override)", () => {
      const result = normalizeConfig({
        tools: { mcp: "ask", read: "allow" },
      });
      expect(result).toEqual([
        { surface: "read", pattern: "*", action: "allow" },
      ]);
    });
  });

  describe("bash entries", () => {
    test("converts bash entries to surface 'bash' rules", () => {
      const result = normalizeConfig({
        bash: { "git *": "allow", "rm -rf *": "deny" },
      });
      expect(result).toEqual([
        { surface: "bash", pattern: "git *", action: "allow" },
        { surface: "bash", pattern: "rm -rf *", action: "deny" },
      ]);
    });
  });

  describe("mcp entries", () => {
    test("converts mcp entries to surface 'mcp' rules", () => {
      const result = normalizeConfig({
        mcp: { "exa:*": "allow", mcp_status: "allow" },
      });
      expect(result).toEqual([
        { surface: "mcp", pattern: "exa:*", action: "allow" },
        { surface: "mcp", pattern: "mcp_status", action: "allow" },
      ]);
    });
  });

  describe("skills entries", () => {
    test("converts skills entries to surface 'skill' rules", () => {
      const result = normalizeConfig({
        skills: { "*": "ask", librarian: "allow" },
      });
      expect(result).toEqual([
        { surface: "skill", pattern: "*", action: "ask" },
        { surface: "skill", pattern: "librarian", action: "allow" },
      ]);
    });
  });

  describe("special entries", () => {
    test("converts special entries to surface 'special' with key as pattern", () => {
      const result = normalizeConfig({
        special: { external_directory: "ask" },
      });
      expect(result).toEqual([
        { surface: "special", pattern: "external_directory", action: "ask" },
      ]);
    });
  });

  describe("ordering", () => {
    test("tools.bash excluded; bash entries come after tools", () => {
      const result = normalizeConfig({
        tools: { bash: "allow", read: "deny" },
        bash: { "git *": "ask" },
      });
      expect(result).toEqual([
        { surface: "read", pattern: "*", action: "deny" },
        { surface: "bash", pattern: "git *", action: "ask" },
      ]);
    });

    test("full ordering: tools → bash → mcp → skills → special", () => {
      const result = normalizeConfig({
        tools: { read: "allow" },
        bash: { "git *": "allow" },
        mcp: { "exa:*": "allow" },
        skills: { librarian: "allow" },
        special: { external_directory: "ask" },
      });
      expect(result).toEqual([
        { surface: "read", pattern: "*", action: "allow" },
        { surface: "bash", pattern: "git *", action: "allow" },
        { surface: "mcp", pattern: "exa:*", action: "allow" },
        { surface: "skill", pattern: "librarian", action: "allow" },
        { surface: "special", pattern: "external_directory", action: "ask" },
      ]);
    });
  });

  describe("empty and missing sections", () => {
    test("empty config produces empty ruleset", () => {
      expect(normalizeConfig({})).toEqual([]);
    });

    test("undefined sections are skipped", () => {
      expect(normalizeConfig({ tools: undefined })).toEqual([]);
    });
  });
});
