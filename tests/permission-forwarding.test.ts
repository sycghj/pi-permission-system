import { afterEach, describe, expect, test, vi } from "vitest";
import {
  resolvePermissionForwardingTargetSessionId,
  SUBAGENT_PARENT_SESSION_ENV_CANDIDATES,
  SUBAGENT_PARENT_SESSION_ENV_KEY,
} from "../src/permission-forwarding";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SUBAGENT_PARENT_SESSION_ENV_CANDIDATES", () => {
  test("is an array containing PI_AGENT_ROUTER_PARENT_SESSION_ID", () => {
    expect(Array.isArray(SUBAGENT_PARENT_SESSION_ENV_CANDIDATES)).toBe(true);
    expect(SUBAGENT_PARENT_SESSION_ENV_CANDIDATES).toContain(
      "PI_AGENT_ROUTER_PARENT_SESSION_ID",
    );
  });

  test("deprecated SUBAGENT_PARENT_SESSION_ENV_KEY equals the first candidate", () => {
    expect(SUBAGENT_PARENT_SESSION_ENV_KEY).toBe(
      SUBAGENT_PARENT_SESSION_ENV_CANDIDATES[0],
    );
  });
});

describe("resolvePermissionForwardingTargetSessionId", () => {
  test("hasUI=true returns the current session ID (UI host owns forwarding)", () => {
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: true,
        isSubagent: false,
        currentSessionId: "parent-session-abc",
        env: {},
      }),
    ).toBe("parent-session-abc");
  });

  test("hasUI=true with isSubagent=true still returns current session ID", () => {
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: true,
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "other" },
      }),
    ).toBe("session-xyz");
  });

  test("hasUI=false, isSubagent=false returns null", () => {
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: false,
        currentSessionId: "session-xyz",
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-session-abc" },
      }),
    ).toBeNull();
  });

  test("isSubagent=true, no candidates set returns null", () => {
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: {},
      }),
    ).toBeNull();
  });

  test("isSubagent=true, PI_AGENT_ROUTER_PARENT_SESSION_ID set returns its value", () => {
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-session-abc" },
      }),
    ).toBe("parent-session-abc");
  });

  test("isSubagent=true, first candidate absent but second set returns second value", () => {
    // Inject a second candidate at test-time to validate the iteration logic
    // without waiting for a real extension to adopt the convention.
    const originalCandidates = [...SUBAGENT_PARENT_SESSION_ENV_CANDIDATES];
    // Mutate the array via index-assignment through a cast so we can test
    // multi-candidate iteration without changing the exported constant type.
    // This is test-only; production code never mutates the array.
    (SUBAGENT_PARENT_SESSION_ENV_CANDIDATES as unknown as string[]).push(
      "PI_SUBAGENT_PARENT_SESSION_ID_TEST_ONLY",
    );

    try {
      expect(
        resolvePermissionForwardingTargetSessionId({
          hasUI: false,
          isSubagent: true,
          currentSessionId: "session-xyz",
          env: {
            PI_SUBAGENT_PARENT_SESSION_ID_TEST_ONLY: "parent-from-second",
          },
        }),
      ).toBe("parent-from-second");
    } finally {
      // Restore original array contents.
      (SUBAGENT_PARENT_SESSION_ENV_CANDIDATES as unknown as string[]).length =
        originalCandidates.length;
    }
  });

  test("isSubagent=true, candidate value is empty string returns null", () => {
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "" },
      }),
    ).toBeNull();
  });

  test("isSubagent=true, candidate value is 'unknown' returns null", () => {
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "unknown" },
      }),
    ).toBeNull();
  });

  test("env defaults to process.env when omitted", () => {
    vi.stubEnv("PI_AGENT_ROUTER_PARENT_SESSION_ID", "env-session-abc");
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
      }),
    ).toBe("env-session-abc");
  });
});
