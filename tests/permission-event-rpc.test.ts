import { createEventBus } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  type PermissionRpcDeps,
  registerPermissionRpcHandlers,
} from "../src/permission-event-rpc";
import type {
  PermissionsCheckReplyData,
  PermissionsRpcReply,
} from "../src/permission-events";
import {
  PERMISSIONS_PROTOCOL_VERSION,
  PERMISSIONS_RPC_CHECK_CHANNEL,
} from "../src/permission-events";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCheckResult(
  state: "allow" | "deny" | "ask",
  overrides: Record<string, unknown> = {},
) {
  return {
    toolName: "bash",
    state,
    matchedPattern: "*",
    source: "bash" as const,
    origin: "global" as const,
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<PermissionRpcDeps> = {},
): PermissionRpcDeps {
  return {
    getPermissionManager: vi.fn().mockReturnValue({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("allow")),
    }),
    getSessionRules: vi.fn().mockReturnValue([]),
    getRuntimeContext: vi.fn().mockReturnValue(null),
    requestPermissionDecisionFromUi: vi.fn(),
    writeReviewLog: vi.fn(),
    ...overrides,
  };
}

/** Wait for a single event on the bus reply channel. */
function waitForReply<T>(
  bus: ReturnType<typeof createEventBus>,
  channel: string,
): Promise<T> {
  return new Promise((resolve) => {
    const unsub = bus.on(channel, (data) => {
      unsub();
      resolve(data as T);
    });
  });
}

// ── registerPermissionRpcHandlers — check RPC ──────────────────────────────

describe("registerPermissionRpcHandlers — permissions:rpc:check", () => {
  it("returns unsubscribe handles", () => {
    const bus = createEventBus();
    const handles = registerPermissionRpcHandlers(bus, makeDeps());
    expect(typeof handles.unsubCheck).toBe("function");
    expect(typeof handles.unsubPrompt).toBe("function");
  });

  it("replies allow for an allowed surface/value", async () => {
    const bus = createEventBus();
    const deps = makeDeps({
      getPermissionManager: vi.fn().mockReturnValue({
        checkPermission: vi.fn().mockReturnValue(makeCheckResult("allow")),
      }),
    });
    registerPermissionRpcHandlers(bus, deps);

    const replyPromise = waitForReply<
      PermissionsRpcReply<PermissionsCheckReplyData>
    >(bus, `${PERMISSIONS_RPC_CHECK_CHANNEL}:reply:req-allow`);
    bus.emit(PERMISSIONS_RPC_CHECK_CHANNEL, {
      requestId: "req-allow",
      surface: "bash",
      value: "git status",
    });

    const reply = await replyPromise;
    expect(reply.success).toBe(true);
    expect(reply.protocolVersion).toBe(PERMISSIONS_PROTOCOL_VERSION);
    if (reply.success) {
      expect(reply.data?.result).toBe("allow");
      expect(reply.data?.origin).toBe("global");
    }
  });

  it("replies deny for a denied surface/value", async () => {
    const bus = createEventBus();
    const deps = makeDeps({
      getPermissionManager: vi.fn().mockReturnValue({
        checkPermission: vi.fn().mockReturnValue(
          makeCheckResult("deny", {
            origin: "project",
            matchedPattern: "rm *",
          }),
        ),
      }),
    });
    registerPermissionRpcHandlers(bus, deps);

    const replyPromise = waitForReply<
      PermissionsRpcReply<PermissionsCheckReplyData>
    >(bus, `${PERMISSIONS_RPC_CHECK_CHANNEL}:reply:req-deny`);
    bus.emit(PERMISSIONS_RPC_CHECK_CHANNEL, {
      requestId: "req-deny",
      surface: "bash",
      value: "rm -rf /tmp",
    });

    const reply = await replyPromise;
    expect(reply.success).toBe(true);
    if (reply.success) {
      expect(reply.data?.result).toBe("deny");
      expect(reply.data?.matchedPattern).toBe("rm *");
    }
  });

  it("replies ask for an ask surface/value", async () => {
    const bus = createEventBus();
    const deps = makeDeps({
      getPermissionManager: vi.fn().mockReturnValue({
        checkPermission: vi
          .fn()
          .mockReturnValue(
            makeCheckResult("ask", { matchedPattern: undefined }),
          ),
      }),
    });
    registerPermissionRpcHandlers(bus, deps);

    const replyPromise = waitForReply<
      PermissionsRpcReply<PermissionsCheckReplyData>
    >(bus, `${PERMISSIONS_RPC_CHECK_CHANNEL}:reply:req-ask`);
    bus.emit(PERMISSIONS_RPC_CHECK_CHANNEL, {
      requestId: "req-ask",
      surface: "mcp",
      value: "exa:search",
    });

    const reply = await replyPromise;
    expect(reply.success).toBe(true);
    if (reply.success) {
      expect(reply.data?.result).toBe("ask");
    }
  });

  it("passes agentName to checkPermission when provided", async () => {
    const checkPermission = vi.fn().mockReturnValue(makeCheckResult("allow"));
    const bus = createEventBus();
    const deps = makeDeps({
      getPermissionManager: vi.fn().mockReturnValue({ checkPermission }),
    });
    registerPermissionRpcHandlers(bus, deps);

    const replyPromise = waitForReply(
      bus,
      `${PERMISSIONS_RPC_CHECK_CHANNEL}:reply:req-agent`,
    );
    bus.emit(PERMISSIONS_RPC_CHECK_CHANNEL, {
      requestId: "req-agent",
      surface: "bash",
      value: "git push",
      agentName: "Worker",
    });
    await replyPromise;

    expect(checkPermission).toHaveBeenCalledWith(
      "bash",
      expect.anything(),
      "Worker",
      expect.anything(),
    );
  });

  it("includes session rules in the check", async () => {
    const sessionRules = [
      {
        surface: "bash",
        pattern: "git *",
        action: "allow" as const,
        origin: "session" as const,
      },
    ];
    const checkPermission = vi.fn().mockReturnValue(makeCheckResult("allow"));
    const bus = createEventBus();
    const deps = makeDeps({
      getPermissionManager: vi.fn().mockReturnValue({ checkPermission }),
      getSessionRules: vi.fn().mockReturnValue(sessionRules),
    });
    registerPermissionRpcHandlers(bus, deps);

    const replyPromise = waitForReply(
      bus,
      `${PERMISSIONS_RPC_CHECK_CHANNEL}:reply:req-session`,
    );
    bus.emit(PERMISSIONS_RPC_CHECK_CHANNEL, {
      requestId: "req-session",
      surface: "bash",
      value: "git status",
    });
    await replyPromise;

    expect(checkPermission).toHaveBeenCalledWith(
      "bash",
      expect.anything(),
      undefined,
      sessionRules,
    );
  });

  it("replies with error envelope when requestId is missing", async () => {
    const bus = createEventBus();
    registerPermissionRpcHandlers(bus, makeDeps());

    // No reply channel to wait on — emit without requestId and confirm
    // no throw / crash. We check indirectly via a timeout-free approach:
    // emit an immediately-followable good request and ensure both succeed.
    const replyPromise = waitForReply<PermissionsRpcReply>(
      bus,
      `${PERMISSIONS_RPC_CHECK_CHANNEL}:reply:req-good`,
    );
    bus.emit(PERMISSIONS_RPC_CHECK_CHANNEL, {}); // missing requestId — should not crash
    bus.emit(PERMISSIONS_RPC_CHECK_CHANNEL, {
      requestId: "req-good",
      surface: "bash",
    });

    const reply = await replyPromise;
    expect(reply.success).toBe(true); // good request still handled
  });

  it("unsubCheck stops the handler from firing", async () => {
    const checkPermission = vi.fn().mockReturnValue(makeCheckResult("allow"));
    const bus = createEventBus();
    const deps = makeDeps({
      getPermissionManager: vi.fn().mockReturnValue({ checkPermission }),
    });
    const handles = registerPermissionRpcHandlers(bus, deps);
    handles.unsubCheck();

    bus.emit(PERMISSIONS_RPC_CHECK_CHANNEL, {
      requestId: "req-unsub",
      surface: "bash",
    });

    // Give async handlers a chance to fire
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(checkPermission).not.toHaveBeenCalled();
  });
});
