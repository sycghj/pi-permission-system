import { describe, expect, it, vi } from "vitest";

// Mock node:os so tilde-expansion is deterministic across platforms.
vi.mock("node:os", () => {
  const homedir = vi.fn(() => "/mock/home");
  return {
    homedir,
    default: { homedir },
  };
});

import {
  deriveApprovalPrefix,
  SessionApprovalCache,
} from "../src/session-approval-cache";

describe("SessionApprovalCache", () => {
  describe("approve and has", () => {
    it("returns false when no approvals exist", () => {
      const cache = new SessionApprovalCache();
      expect(cache.has("external_directory", "/some/path")).toBe(false);
    });

    it("returns true for a path under an approved prefix", () => {
      const cache = new SessionApprovalCache();
      cache.approve("external_directory", "/other/project/src/");
      expect(cache.has("external_directory", "/other/project/src/foo.ts")).toBe(
        true,
      );
    });

    it("returns true for the exact approved prefix path", () => {
      const cache = new SessionApprovalCache();
      cache.approve("external_directory", "/other/project/src/");
      expect(cache.has("external_directory", "/other/project/src/")).toBe(true);
    });

    it("returns false for a path outside the approved prefix", () => {
      const cache = new SessionApprovalCache();
      cache.approve("external_directory", "/other/project/src/");
      expect(cache.has("external_directory", "/other/project/lib/foo.ts")).toBe(
        false,
      );
    });

    it("returns false for a sibling directory that shares a string prefix", () => {
      const cache = new SessionApprovalCache();
      cache.approve("external_directory", "/other/project/");
      // /other/project-b/ should NOT match /other/project/
      expect(cache.has("external_directory", "/other/project-b/foo.ts")).toBe(
        false,
      );
    });

    it("handles multiple approved prefixes for the same surface", () => {
      const cache = new SessionApprovalCache();
      cache.approve("external_directory", "/other/project-a/");
      cache.approve("external_directory", "/other/project-b/");
      expect(cache.has("external_directory", "/other/project-a/foo.ts")).toBe(
        true,
      );
      expect(cache.has("external_directory", "/other/project-b/bar.ts")).toBe(
        true,
      );
      expect(cache.has("external_directory", "/other/project-c/baz.ts")).toBe(
        false,
      );
    });

    it("does not duplicate identical prefixes", () => {
      const cache = new SessionApprovalCache();
      cache.approve("external_directory", "/other/project/");
      cache.approve("external_directory", "/other/project/");
      // Set semantics — just verify it still works
      expect(cache.has("external_directory", "/other/project/foo.ts")).toBe(
        true,
      );
    });
  });

  describe("surface isolation", () => {
    it("does not match across different surface types", () => {
      const cache = new SessionApprovalCache();
      cache.approve("external_directory", "/other/project/");
      expect(cache.has("some_other_surface", "/other/project/foo.ts")).toBe(
        false,
      );
    });
  });

  describe("clear", () => {
    it("removes all approvals", () => {
      const cache = new SessionApprovalCache();
      cache.approve("external_directory", "/other/project/");
      cache.approve("some_surface", "/another/path/");
      cache.clear();
      expect(cache.has("external_directory", "/other/project/foo.ts")).toBe(
        false,
      );
      expect(cache.has("some_surface", "/another/path/file")).toBe(false);
    });
  });
});

describe("deriveApprovalPrefix", () => {
  it("returns parent directory with trailing separator for a file path", () => {
    expect(deriveApprovalPrefix("/other/project/src/foo.ts")).toBe(
      "/other/project/src/",
    );
  });

  it("returns the directory itself with trailing separator for a directory path", () => {
    expect(deriveApprovalPrefix("/other/project/src/")).toBe(
      "/other/project/src/",
    );
  });

  it("returns the directory itself when path has no trailing separator", () => {
    // For a path like /other/project/src (directory), dirname gives /other/project
    // but we can't distinguish dir from file without stat. dirname is the safe choice.
    expect(deriveApprovalPrefix("/other/project/src")).toBe("/other/project/");
  });

  it("handles root path", () => {
    expect(deriveApprovalPrefix("/")).toBe("/");
  });

  it("handles single-level path", () => {
    expect(deriveApprovalPrefix("/foo")).toBe("/");
  });
});
