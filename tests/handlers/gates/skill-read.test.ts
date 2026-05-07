import { describe, expect, it, vi } from "vitest";

import { evaluateSkillReadGate } from "../../../src/handlers/gates/skill-read";
import type { ToolCallContext } from "../../../src/handlers/gates/types";
import type { HandlerDeps } from "../../../src/handlers/types";
import type { PermissionEventBus } from "../../../src/permission-events";
import type { SkillPromptEntry } from "../../../src/skill-prompt-sanitizer";

// ── SDK stubs ──────────────────────────────────────────────────────────────
vi.mock("@mariozechner/pi-coding-agent", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@mariozechner/pi-coding-agent")>();
  return { ...original };
});

// ── helpers ────────────────────────────────────────────────────────────────

function makeSkillEntry(
  overrides: Partial<SkillPromptEntry> = {},
): SkillPromptEntry {
  return {
    name: "librarian",
    description: "Research skills",
    location: "/skills/librarian/SKILL.md",
    state: "ask",
    normalizedLocation: "/skills/librarian/SKILL.md",
    normalizedBaseDir: "/skills/librarian",
    ...overrides,
  };
}

function makeTcc(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    toolName: "read",
    agentName: null,
    input: { path: "/skills/librarian/SKILL.md" },
    toolCallId: "tc-1",
    cwd: "/test/project",
    ...overrides,
  };
}

function makeEvents(): PermissionEventBus {
  return { emit: vi.fn(), on: vi.fn().mockReturnValue(() => undefined) };
}

function makeRuntime(
  overrides: Record<string, unknown> = {},
): HandlerDeps["runtime"] {
  return {
    activeSkillEntries: [],
    writeReviewLog: vi.fn(),
    ...overrides,
  } as unknown as HandlerDeps["runtime"];
}

function makeDeps(overrides: Record<string, unknown> = {}): HandlerDeps {
  const { runtime: runtimeOverrides, events, ...rest } = overrides;
  return {
    runtime: makeRuntime(runtimeOverrides as Record<string, unknown>),
    events: events ?? makeEvents(),
    canRequestPermissionConfirmation: vi.fn().mockReturnValue(true),
    promptPermission: vi
      .fn()
      .mockResolvedValue({ approved: true, state: "approved" }),
    ...rest,
  } as unknown as HandlerDeps;
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("evaluateSkillReadGate", () => {
  it("returns null when tool is not read", async () => {
    const tcc = makeTcc({ toolName: "write" });
    const deps = makeDeps({
      runtime: { activeSkillEntries: [makeSkillEntry()] },
    });
    const result = await evaluateSkillReadGate(tcc, deps);
    expect(result).toBeNull();
  });

  it("returns null when no active skill entries", async () => {
    const tcc = makeTcc();
    const deps = makeDeps({ runtime: { activeSkillEntries: [] } });
    const result = await evaluateSkillReadGate(tcc, deps);
    expect(result).toBeNull();
  });

  it("returns null when read path does not match any skill", async () => {
    const tcc = makeTcc({ input: { path: "/test/project/src/index.ts" } });
    const deps = makeDeps({
      runtime: { activeSkillEntries: [makeSkillEntry()] },
    });
    const result = await evaluateSkillReadGate(tcc, deps);
    expect(result).toBeNull();
  });

  it("returns allow when skill state is allow", async () => {
    const tcc = makeTcc();
    const deps = makeDeps({
      runtime: {
        activeSkillEntries: [makeSkillEntry({ state: "allow" })],
      },
    });
    const result = await evaluateSkillReadGate(tcc, deps);
    expect(result).toEqual({ action: "allow" });
  });

  it("returns block when skill state is deny", async () => {
    const tcc = makeTcc();
    const deps = makeDeps({
      runtime: {
        activeSkillEntries: [makeSkillEntry({ state: "deny" })],
      },
    });
    const result = await evaluateSkillReadGate(tcc, deps);
    expect(result).toMatchObject({ action: "block" });
  });

  it("returns allow when state is ask and user approves", async () => {
    const tcc = makeTcc();
    const deps = makeDeps({
      runtime: {
        activeSkillEntries: [makeSkillEntry({ state: "ask" })],
      },
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" }),
    });
    const result = await evaluateSkillReadGate(tcc, deps);
    expect(result).toEqual({ action: "allow" });
  });

  it("returns block when state is ask and user denies", async () => {
    const tcc = makeTcc();
    const deps = makeDeps({
      runtime: {
        activeSkillEntries: [makeSkillEntry({ state: "ask" })],
      },
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: false, state: "denied" }),
    });
    const result = await evaluateSkillReadGate(tcc, deps);
    expect(result).toMatchObject({ action: "block" });
  });

  it("returns block when state is ask and no UI available", async () => {
    const tcc = makeTcc();
    const deps = makeDeps({
      runtime: {
        activeSkillEntries: [makeSkillEntry({ state: "ask" })],
      },
      canRequestPermissionConfirmation: vi.fn().mockReturnValue(false),
    });
    const result = await evaluateSkillReadGate(tcc, deps);
    expect(result).toMatchObject({ action: "block" });
  });

  it("emits decision event with correct fields on deny", async () => {
    const events = makeEvents();
    const tcc = makeTcc({ agentName: "test-agent" });
    const deps = makeDeps({
      runtime: {
        activeSkillEntries: [makeSkillEntry({ state: "deny" })],
      },
      events,
    });
    await evaluateSkillReadGate(tcc, deps);
    expect(events.emit).toHaveBeenCalledWith(
      "permissions:decision",
      expect.objectContaining({
        surface: "skill",
        value: "librarian",
        result: "deny",
        resolution: "policy_deny",
        origin: null,
        agentName: "test-agent",
        matchedPattern: null,
      }),
    );
  });

  it("emits decision event with correct fields on allow", async () => {
    const events = makeEvents();
    const tcc = makeTcc();
    const deps = makeDeps({
      runtime: {
        activeSkillEntries: [makeSkillEntry({ state: "allow" })],
      },
      events,
    });
    await evaluateSkillReadGate(tcc, deps);
    expect(events.emit).toHaveBeenCalledWith(
      "permissions:decision",
      expect.objectContaining({
        surface: "skill",
        value: "librarian",
        result: "allow",
        resolution: "policy_allow",
      }),
    );
  });
});
