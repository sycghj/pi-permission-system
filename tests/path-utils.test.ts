import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

// Mock node:os so tilde-expansion is deterministic across platforms.
vi.mock("node:os", () => {
  const homedir = vi.fn(() => "/mock/home");
  return {
    homedir,
    default: { homedir },
  };
});

import {
  isPathWithinDirectory,
  normalizePathForComparison,
} from "../src/path-utils";

describe("normalizePathForComparison", () => {
  const cwd = "/projects/my-app";

  test("resolves absolute path unchanged", () => {
    expect(normalizePathForComparison("/usr/local/bin", cwd)).toBe(
      "/usr/local/bin",
    );
  });

  test("resolves relative path against cwd", () => {
    expect(normalizePathForComparison("src/foo.ts", cwd)).toBe(
      "/projects/my-app/src/foo.ts",
    );
  });

  test("expands bare ~ to homedir", () => {
    expect(normalizePathForComparison("~", cwd)).toBe("/mock/home");
  });

  test("expands ~/... to homedir-relative path", () => {
    expect(normalizePathForComparison("~/docs/readme.md", cwd)).toBe(
      join("/mock/home", "docs/readme.md"),
    );
  });

  test("strips leading @ before resolving", () => {
    expect(normalizePathForComparison("@/usr/local/bin", cwd)).toBe(
      "/usr/local/bin",
    );
  });

  test("strips surrounding quotes", () => {
    expect(normalizePathForComparison("'/usr/local/bin'", cwd)).toBe(
      "/usr/local/bin",
    );
    expect(normalizePathForComparison('"/usr/local/bin"', cwd)).toBe(
      "/usr/local/bin",
    );
  });

  test("returns empty string for blank/whitespace-only path", () => {
    expect(normalizePathForComparison("", cwd)).toBe("");
    expect(normalizePathForComparison("   ", cwd)).toBe("");
  });
});

describe("isPathWithinDirectory", () => {
  test("returns true when path equals directory", () => {
    expect(isPathWithinDirectory("/a/b", "/a/b")).toBe(true);
  });

  test("returns true when path is a direct child", () => {
    expect(isPathWithinDirectory("/a/b/c", "/a/b")).toBe(true);
  });

  test("returns true when path is a deep descendant", () => {
    expect(isPathWithinDirectory("/a/b/c/d/e", "/a/b")).toBe(true);
  });

  test("returns false when path is a sibling directory", () => {
    expect(isPathWithinDirectory("/a/bc", "/a/b")).toBe(false);
  });

  test("returns false when path is outside the directory", () => {
    expect(isPathWithinDirectory("/other/path", "/a/b")).toBe(false);
  });

  test("returns false for empty path", () => {
    expect(isPathWithinDirectory("", "/a/b")).toBe(false);
  });

  test("returns false for empty directory", () => {
    expect(isPathWithinDirectory("/a/b", "")).toBe(false);
  });
});
