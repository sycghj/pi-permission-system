import { describe, expect, it } from "vitest";

import {
  deriveDecisionValue,
  deriveResolution,
} from "../../../src/handlers/gates/helpers";

describe("deriveDecisionValue", () => {
  it("returns command for bash", () => {
    expect(deriveDecisionValue("bash", { command: "git status" })).toBe(
      "git status",
    );
  });

  it("falls back to toolName when bash has no command", () => {
    expect(deriveDecisionValue("bash", {})).toBe("bash");
  });

  it("returns target for mcp", () => {
    expect(deriveDecisionValue("mcp", { target: "exa:search" })).toBe(
      "exa:search",
    );
  });

  it("falls back to toolName when mcp has no target", () => {
    expect(deriveDecisionValue("mcp", {})).toBe("mcp");
  });

  it("returns toolName for other tools", () => {
    expect(deriveDecisionValue("read", {})).toBe("read");
    expect(deriveDecisionValue("write", { command: "ignored" })).toBe("write");
  });
});

describe("deriveResolution", () => {
  it("returns policy_allow for allow state", () => {
    expect(deriveResolution("allow", "allow", false, true)).toBe(
      "policy_allow",
    );
  });

  it("returns policy_deny for deny state", () => {
    expect(deriveResolution("deny", "block", false, true)).toBe("policy_deny");
  });

  it("returns user_approved for ask + allow without session", () => {
    expect(deriveResolution("ask", "allow", false, true)).toBe("user_approved");
  });

  it("returns user_approved_for_session for ask + allow with session", () => {
    expect(deriveResolution("ask", "allow", true, true)).toBe(
      "user_approved_for_session",
    );
  });

  it("returns auto_approved when autoApproved flag is set", () => {
    expect(deriveResolution("ask", "allow", false, true, true)).toBe(
      "auto_approved",
    );
  });

  it("returns user_denied for ask + block with canConfirm", () => {
    expect(deriveResolution("ask", "block", false, true)).toBe("user_denied");
  });

  it("returns confirmation_unavailable for ask + block without canConfirm", () => {
    expect(deriveResolution("ask", "block", false, false)).toBe(
      "confirmation_unavailable",
    );
  });
});
