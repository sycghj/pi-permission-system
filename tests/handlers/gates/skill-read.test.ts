import { describe, expect, it, vi } from "vitest";

import { evaluateSkillReadGate } from "../../../src/handlers/gates/skill-read";
import type {
  SkillReadGateDeps,
  ToolCallContext,
} from "../../../src/handlers/gates/types";
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

function makeSkillReadGateDeps(
  overrides: Partial<SkillReadGateDeps> = {},
): SkillReadGateDeps {
  return {
    getActiveSkillEntries: vi.fn().mockReturnValue([]),
    writeReviewLog: vi.fn(),
    emitDecision: vi.fn(),
    canConfirm: vi.fn().mockReturnValue(true),
    promptPermission: vi
      .fn()
      .mockResolvedValue({ approved: true, state: "approved" }),
    ...overrides,
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("evaluateSkillReadGate", () => {
  it("returns null when tool is not read", async () => {
    const tcc = makeTcc({ toolName: "write" });
    const deps = makeSkillReadGateDeps({
      getActiveSkillEntries: vi.fn().mockReturnValue([makeSkillEntry()]),
    });
    const result = await evaluateSkillReadGate(tcc, deps);
    expect(result).toBeNull();
  });

  it("returns null when no active skill entries", async () => {
    const tcc = makeTcc();
    const deps = makeSkillReadGateDeps({
      getActiveSkillEntries: vi.fn().mockReturnValue([]),
    });
    const result = await evaluateSkillReadGate(tcc, deps);
    expect(result).toBeNull();
  });

  it("returns null when read path does not match any skill", async () => {
    const tcc = makeTcc({ input: { path: "/test/project/src/index.ts" } });
    const deps = makeSkillReadGateDeps({
      getActiveSkillEntries: vi.fn().mockReturnValue([makeSkillEntry()]),
    });
    const result = await evaluateSkillReadGate(tcc, deps);
    expect(result).toBeNull();
  });

  it("returns allow when skill state is allow", async () => {
    const tcc = makeTcc();
    const deps = makeSkillReadGateDeps({
      getActiveSkillEntries: vi
        .fn()
        .mockReturnValue([makeSkillEntry({ state: "allow" })]),
    });
    const result = await evaluateSkillReadGate(tcc, deps);
    expect(result).toEqual({ action: "allow" });
  });

  it("returns block when skill state is deny", async () => {
    const tcc = makeTcc();
    const deps = makeSkillReadGateDeps({
      getActiveSkillEntries: vi
        .fn()
        .mockReturnValue([makeSkillEntry({ state: "deny" })]),
    });
    const result = await evaluateSkillReadGate(tcc, deps);
    expect(result).toMatchObject({ action: "block" });
  });

  it("returns allow when state is ask and user approves", async () => {
    const tcc = makeTcc();
    const deps = makeSkillReadGateDeps({
      getActiveSkillEntries: vi
        .fn()
        .mockReturnValue([makeSkillEntry({ state: "ask" })]),
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" }),
    });
    const result = await evaluateSkillReadGate(tcc, deps);
    expect(result).toEqual({ action: "allow" });
  });

  it("returns block when state is ask and user denies", async () => {
    const tcc = makeTcc();
    const deps = makeSkillReadGateDeps({
      getActiveSkillEntries: vi
        .fn()
        .mockReturnValue([makeSkillEntry({ state: "ask" })]),
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: false, state: "denied" }),
    });
    const result = await evaluateSkillReadGate(tcc, deps);
    expect(result).toMatchObject({ action: "block" });
  });

  it("returns block when state is ask and no UI available", async () => {
    const tcc = makeTcc();
    const deps = makeSkillReadGateDeps({
      getActiveSkillEntries: vi
        .fn()
        .mockReturnValue([makeSkillEntry({ state: "ask" })]),
      canConfirm: vi.fn().mockReturnValue(false),
    });
    const result = await evaluateSkillReadGate(tcc, deps);
    expect(result).toMatchObject({ action: "block" });
  });

  it("emits decision event with correct fields on deny", async () => {
    const tcc = makeTcc({ agentName: "test-agent" });
    const deps = makeSkillReadGateDeps({
      getActiveSkillEntries: vi
        .fn()
        .mockReturnValue([makeSkillEntry({ state: "deny" })]),
    });
    await evaluateSkillReadGate(tcc, deps);
    expect(deps.emitDecision).toHaveBeenCalledWith(
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
    const tcc = makeTcc();
    const deps = makeSkillReadGateDeps({
      getActiveSkillEntries: vi
        .fn()
        .mockReturnValue([makeSkillEntry({ state: "allow" })]),
    });
    await evaluateSkillReadGate(tcc, deps);
    expect(deps.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "skill",
        value: "librarian",
        result: "allow",
        resolution: "policy_allow",
      }),
    );
  });
});
