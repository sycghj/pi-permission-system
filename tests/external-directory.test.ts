import { describe, expect, test, vi } from "vitest";

import {
  formatExternalDirectoryAskPrompt,
  formatExternalDirectoryDenyReason,
  formatExternalDirectoryHardStopHint,
  formatExternalDirectoryUserDeniedReason,
} from "../src/external-directory";

describe("formatExternalDirectoryHardStopHint", () => {
  test("returns the hard stop instruction string", () => {
    const hint = formatExternalDirectoryHardStopHint();
    expect(hint).toContain("Hard stop");
    expect(hint).toContain("external directory");
  });
});

describe("formatExternalDirectoryAskPrompt", () => {
  test("uses 'Current agent' when no agent name provided", () => {
    const result = formatExternalDirectoryAskPrompt(
      "read",
      "/etc/passwd",
      "/projects/my-app",
    );
    expect(result).toContain("Current agent");
    expect(result).toContain("read");
    expect(result).toContain("/etc/passwd");
    expect(result).toContain("/projects/my-app");
  });

  test("uses agent name when provided", () => {
    const result = formatExternalDirectoryAskPrompt(
      "write",
      "/tmp/out.txt",
      "/projects/my-app",
      "my-agent",
    );
    expect(result).toContain("Agent 'my-agent'");
    expect(result).toContain("write");
    expect(result).toContain("/tmp/out.txt");
  });
});

describe("formatExternalDirectoryDenyReason", () => {
  test("includes tool name, path, cwd, agent name, and hard stop hint", () => {
    const result = formatExternalDirectoryDenyReason(
      "read",
      "/etc/passwd",
      "/projects/my-app",
      "sec-agent",
    );
    expect(result).toContain("Agent 'sec-agent'");
    expect(result).toContain("read");
    expect(result).toContain("/etc/passwd");
    expect(result).toContain("/projects/my-app");
    expect(result).toContain("Hard stop");
  });

  test("uses 'Current agent' without agent name", () => {
    const result = formatExternalDirectoryDenyReason(
      "read",
      "/etc",
      "/projects",
    );
    expect(result).toContain("Current agent");
  });
});

describe("formatExternalDirectoryUserDeniedReason", () => {
  test("includes tool name and path", () => {
    const result = formatExternalDirectoryUserDeniedReason(
      "edit",
      "/etc/hosts",
    );
    expect(result).toContain("edit");
    expect(result).toContain("/etc/hosts");
    expect(result).toContain("Hard stop");
  });

  test("appends denial reason when provided", () => {
    const result = formatExternalDirectoryUserDeniedReason(
      "edit",
      "/etc/hosts",
      "too risky",
    );
    expect(result).toContain("Reason: too risky");
  });

  test("omits reason suffix when not provided", () => {
    const result = formatExternalDirectoryUserDeniedReason(
      "edit",
      "/etc/hosts",
    );
    expect(result).not.toContain("Reason:");
  });
});
