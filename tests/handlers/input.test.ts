import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  extractSkillNameFromInput,
  handleInput,
} from "../../src/handlers/input";
import type { HandlerDeps } from "../../src/handlers/types";
import type { PermissionSession } from "../../src/permission-session";
import type { PermissionState } from "../../src/types";

// ── helpers ────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  return {
    cwd: "/test/project",
    hasUI: true,
    ui: {
      setStatus: vi.fn(),
      notify: vi.fn(),
      select: vi.fn(),
      input: vi.fn(),
    },
    sessionManager: {
      getEntries: vi.fn().mockReturnValue([]),
      getSessionDir: vi.fn().mockReturnValue("/sessions/test"),
      addEntry: vi.fn(),
    },
    ...overrides,
  } as unknown as ExtensionContext;
}

function makeInputEvent(text: string) {
  return { text };
}

function makeSession(
  overrides: Partial<Record<keyof PermissionSession, unknown>> = {},
): PermissionSession {
  return {
    logger: { debug: vi.fn(), review: vi.fn(), warn: vi.fn() },
    activate: vi.fn(),
    resolveAgentName: vi.fn().mockReturnValue(null),
    checkPermission: vi.fn().mockReturnValue({ state: "allow" }),
    getToolPermission: vi.fn().mockReturnValue("allow" as PermissionState),
    getSessionRuleset: vi.fn().mockReturnValue([]),
    approveSessionRule: vi.fn(),
    ...overrides,
  } as unknown as PermissionSession;
}

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    session: makeSession(),
    events: { emit: vi.fn(), on: vi.fn().mockReturnValue(() => undefined) },
    canRequestPermissionConfirmation: vi.fn().mockReturnValue(true),
    promptPermission: vi
      .fn()
      .mockResolvedValue({ approved: true, state: "approved" }),
    createPermissionRequestId: vi.fn().mockReturnValue("req-id"),
    stopPermissionRpcHandlers: vi.fn(),
    getAllTools: vi.fn().mockReturnValue([]),
    setActiveTools: vi.fn(),
    ...overrides,
  };
}

// ── extractSkillNameFromInput ──────────────────────────────────────────────

describe("extractSkillNameFromInput", () => {
  it("returns null for plain text", () => {
    expect(extractSkillNameFromInput("hello world")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractSkillNameFromInput("")).toBeNull();
  });

  it("returns null for bare /skill: with no name", () => {
    expect(extractSkillNameFromInput("/skill:")).toBeNull();
  });

  it("extracts skill name from /skill:<name>", () => {
    expect(extractSkillNameFromInput("/skill:librarian")).toBe("librarian");
  });

  it("extracts skill name stopping at whitespace", () => {
    expect(extractSkillNameFromInput("/skill:librarian some extra")).toBe(
      "librarian",
    );
  });

  it("trims leading whitespace before the prefix", () => {
    expect(extractSkillNameFromInput("  /skill:my-skill")).toBe("my-skill");
  });

  it("returns null when the skill name after trimming is empty", () => {
    expect(extractSkillNameFromInput("/skill: ")).toBeNull();
  });
});

// ── handleInput ───────────────────────────────────────────────────────────

describe("handleInput", () => {
  it("activates session with ctx", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await handleInput(deps, makeInputEvent("hello"), ctx);
    expect(deps.session.activate).toHaveBeenCalledWith(ctx);
  });

  it("returns continue for non-skill input", async () => {
    const deps = makeDeps();
    const result = await handleInput(
      deps,
      makeInputEvent("just a message"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "continue" });
  });

  it("does not check permissions for non-skill input", async () => {
    const deps = makeDeps();
    await handleInput(deps, makeInputEvent("just a message"), makeCtx());
    expect(deps.session.checkPermission).not.toHaveBeenCalled();
  });

  it("returns continue when skill is allowed", async () => {
    const deps = makeDeps();
    const result = await handleInput(
      deps,
      makeInputEvent("/skill:librarian"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "continue" });
  });

  it("returns handled when skill is denied", async () => {
    const session = makeSession({
      checkPermission: vi.fn().mockReturnValue({ state: "deny" }),
    });
    const deps = makeDeps({ session });
    const result = await handleInput(
      deps,
      makeInputEvent("/skill:librarian"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "handled" });
  });

  it("shows a warning notification when skill is denied and UI is available", async () => {
    const ctx = makeCtx({ hasUI: true });
    const session = makeSession({
      checkPermission: vi.fn().mockReturnValue({ state: "deny" }),
    });
    const deps = makeDeps({ session });
    await handleInput(deps, makeInputEvent("/skill:librarian"), ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("librarian"),
      "warning",
    );
  });

  it("does not show a warning notification when skill is denied and UI is absent", async () => {
    const ctx = makeCtx({ hasUI: false });
    const session = makeSession({
      checkPermission: vi.fn().mockReturnValue({ state: "deny" }),
    });
    const deps = makeDeps({ session });
    await handleInput(deps, makeInputEvent("/skill:librarian"), ctx);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("returns handled when skill requires approval but no UI is available", async () => {
    const session = makeSession({
      checkPermission: vi.fn().mockReturnValue({ state: "ask" }),
    });
    const deps = makeDeps({
      session,
      canRequestPermissionConfirmation: vi.fn().mockReturnValue(false),
    });
    const result = await handleInput(
      deps,
      makeInputEvent("/skill:librarian"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "handled" });
  });

  it("prompts and returns continue when skill ask is approved", async () => {
    const session = makeSession({
      checkPermission: vi.fn().mockReturnValue({ state: "ask" }),
    });
    const deps = makeDeps({
      session,
      canRequestPermissionConfirmation: vi.fn().mockReturnValue(true),
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" }),
    });
    const result = await handleInput(
      deps,
      makeInputEvent("/skill:librarian"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "continue" });
    expect(deps.promptPermission).toHaveBeenCalledOnce();
  });

  it("returns handled when skill ask is denied by user", async () => {
    const session = makeSession({
      checkPermission: vi.fn().mockReturnValue({ state: "ask" }),
    });
    const deps = makeDeps({
      session,
      canRequestPermissionConfirmation: vi.fn().mockReturnValue(true),
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: false, state: "denied" }),
    });
    const result = await handleInput(
      deps,
      makeInputEvent("/skill:librarian"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "handled" });
  });

  it("passes agentName in the prompt permission request", async () => {
    const session = makeSession({
      checkPermission: vi.fn().mockReturnValue({ state: "ask" }),
      resolveAgentName: vi.fn().mockReturnValue("code-agent"),
    });
    const deps = makeDeps({
      session,
      canRequestPermissionConfirmation: vi.fn().mockReturnValue(true),
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" }),
    });
    await handleInput(deps, makeInputEvent("/skill:librarian"), makeCtx());
    expect(deps.promptPermission).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agentName: "code-agent",
        skillName: "librarian",
      }),
    );
  });
});
