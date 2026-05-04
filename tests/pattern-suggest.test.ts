import { describe, expect, it } from "vitest";
import {
  suggestBashPattern,
  suggestMcpPattern,
  suggestSessionPattern,
} from "../src/pattern-suggest";

describe("suggestBashPattern", () => {
  it("returns <command> * for a multi-word command", () => {
    expect(suggestBashPattern("git status --short")).toBe("git *");
  });

  it("uses only the first word as the base", () => {
    expect(suggestBashPattern("npm run build")).toBe("npm *");
  });

  it("returns the exact command when there are no arguments", () => {
    expect(suggestBashPattern("ls")).toBe("ls");
  });

  it("trims leading and trailing whitespace", () => {
    expect(suggestBashPattern("  git log  ")).toBe("git *");
  });

  it("handles empty string gracefully", () => {
    expect(suggestBashPattern("")).toBe("");
  });
});

describe("suggestMcpPattern", () => {
  it("suggests server:* for a qualified target (colon-separated)", () => {
    expect(suggestMcpPattern("exa:search")).toBe("exa:*");
  });

  it("suggests server_* for a munged target (underscore-separated)", () => {
    expect(suggestMcpPattern("exa_search")).toBe("exa_*");
  });

  it("suggests * for a bare 'mcp' target", () => {
    expect(suggestMcpPattern("mcp")).toBe("*");
  });

  it("suggests * for a plain tool name with no server prefix", () => {
    expect(suggestMcpPattern("search")).toBe("*");
  });

  it("prefers colon over underscore when both are present", () => {
    // Qualified names contain ':'; the colon check runs first.
    expect(suggestMcpPattern("my-server:some_tool")).toBe("my-server:*");
  });
});

describe("suggestSessionPattern", () => {
  describe("bash surface", () => {
    it("returns bash surface with <command> * pattern for multi-word command", () => {
      const result = suggestSessionPattern("bash", "git status --short");
      expect(result).toMatchObject({
        surface: "bash",
        pattern: "git *",
      });
    });

    it("returns exact command for single-word bash command", () => {
      const result = suggestSessionPattern("bash", "ls");
      expect(result).toMatchObject({ surface: "bash", pattern: "ls" });
    });
  });

  describe("mcp surface", () => {
    it("returns mcp surface with server:* for qualified target", () => {
      const result = suggestSessionPattern("mcp", "exa:search");
      expect(result).toMatchObject({ surface: "mcp", pattern: "exa:*" });
    });

    it("returns mcp surface with server_* for munged target", () => {
      const result = suggestSessionPattern("mcp", "exa_search");
      expect(result).toMatchObject({ surface: "mcp", pattern: "exa_*" });
    });

    it("returns * for bare mcp target", () => {
      const result = suggestSessionPattern("mcp", "mcp");
      expect(result).toMatchObject({ surface: "mcp", pattern: "*" });
    });
  });

  describe("skill surface", () => {
    it("returns exact skill name as pattern", () => {
      const result = suggestSessionPattern("skill", "librarian");
      expect(result).toMatchObject({ surface: "skill", pattern: "librarian" });
    });
  });

  describe("external_directory surface", () => {
    it("returns parent-directory glob from deriveApprovalPattern", () => {
      const result = suggestSessionPattern(
        "external_directory",
        "/tmp/foo.txt",
      );
      expect(result).toMatchObject({
        surface: "external_directory",
        pattern: "/tmp/*",
      });
    });
  });

  describe("tool surfaces", () => {
    it("returns * for read surface", () => {
      const result = suggestSessionPattern("read", "*");
      expect(result).toMatchObject({ surface: "read", pattern: "*" });
    });

    it("returns * for write surface", () => {
      const result = suggestSessionPattern("write", "*");
      expect(result).toMatchObject({ surface: "write", pattern: "*" });
    });

    it("returns * for edit surface", () => {
      const result = suggestSessionPattern("edit", "*");
      expect(result).toMatchObject({ surface: "edit", pattern: "*" });
    });
  });

  describe("label field", () => {
    it("includes the suggested pattern in the label", () => {
      const result = suggestSessionPattern("bash", "git status");
      expect(result.label).toContain("git *");
    });

    it("wraps the pattern in quotes in the label", () => {
      const result = suggestSessionPattern("mcp", "exa:search");
      expect(result.label).toContain('"exa:*"');
    });

    it("label reads as a natural session-approval option", () => {
      const result = suggestSessionPattern("skill", "librarian");
      expect(result.label).toBe('Yes, allow "librarian" for this session');
    });
  });
});
