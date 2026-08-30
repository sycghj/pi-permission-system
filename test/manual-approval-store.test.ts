import { describe, expect, it } from "vitest";
import {
  ManualApprovalStore,
  stableToolInput,
} from "#src/manual-approval-store";

describe("stableToolInput", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(
      stableToolInput({
        z: 1,
        nested: { b: 2, a: 1 },
        items: [{ b: 2, a: 1 }],
      }),
    ).toBe('{"items":[{"a":1,"b":2}],"nested":{"a":1,"b":2},"z":1}');
  });

  it("preserves prototype-shaped JSON keys", () => {
    const input = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
    expect(stableToolInput(input)).toBe('{"__proto__":{"polluted":true}}');
  });
});

describe("ManualApprovalStore", () => {
  it("binds a grant to session, agent, tool, and exact stable input", () => {
    const store = new ManualApprovalStore({ now: () => 1_000 });
    store.issue({
      sessionId: "session-a",
      agentName: "builder",
      toolName: "edit",
      input: { path: "a.ts", edits: [{ newText: "b", oldText: "a" }] },
    });

    expect(
      store.consume({
        sessionId: "session-a",
        agentName: "builder",
        toolName: "edit",
        input: { edits: [{ oldText: "a", newText: "b" }], path: "a.ts" },
      }),
    ).toMatchObject({ toolName: "edit" });
  });

  it("does not consume a grant from another session or agent", () => {
    const store = new ManualApprovalStore({ now: () => 1_000 });
    const invocation = {
      sessionId: "session-a",
      agentName: "builder",
      toolName: "bash",
      input: { command: "danger" },
    } as const;
    store.issue(invocation);

    expect(store.consume({ ...invocation, sessionId: "session-b" })).toBeNull();
    expect(store.consume({ ...invocation, agentName: "reviewer" })).toBeNull();
    expect(store.consume(invocation)).not.toBeNull();
  });

  it("does not consume a grant for a different invocation", () => {
    const store = new ManualApprovalStore({ now: () => 1_000 });
    store.issue({
      sessionId: "session-a",
      agentName: "builder",
      toolName: "bash",
      input: { command: "git reset --hard" },
    });

    expect(
      store.consume({
        sessionId: "session-a",
        agentName: "builder",
        toolName: "bash",
        input: { command: "git reset --hard HEAD~1" },
      }),
    ).toBeNull();
    expect(
      store.consume({
        sessionId: "session-a",
        agentName: "builder",
        toolName: "bash",
        input: { command: "git reset --hard" },
      }),
    ).not.toBeNull();
  });

  it("consumes an exact grant only once", () => {
    const store = new ManualApprovalStore({ now: () => 1_000 });
    const invocation = {
      sessionId: "session-a",
      agentName: null,
      toolName: "write",
      input: { path: "a.txt", content: "x" },
    } as const;
    store.issue(invocation);

    expect(store.consume(invocation)).not.toBeNull();
    expect(store.consume(invocation)).toBeNull();
  });

  it("expires grants after five minutes", () => {
    let now = 1_000;
    const store = new ManualApprovalStore({ now: () => now });
    const invocation = {
      sessionId: "session-a",
      agentName: null,
      toolName: "bash",
      input: { command: "rm file" },
    } as const;
    store.issue(invocation);
    now += 5 * 60_000 + 1;

    expect(store.consume(invocation)).toBeNull();
  });

  it("clears all grants at the session boundary", () => {
    const store = new ManualApprovalStore({ now: () => 1_000 });
    const invocation = {
      sessionId: "session-a",
      agentName: null,
      toolName: "bash",
      input: { command: "rm file" },
    } as const;
    store.issue(invocation);
    store.clear();

    expect(store.consume(invocation)).toBeNull();
  });
});
