import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ClassifierAutoAskDecider } from "#src/auto-mode-classifier";
import type { AutoAskDecisionRequest } from "#src/handlers/gates/auto-ask-decider";
import { makeCheckResult } from "#test/helpers/handler-fixtures";

interface ObservedEvent {
  event: string;
  details: Record<string, unknown>;
}

const request: AutoAskDecisionRequest = {
  agentName: null,
  check: makeCheckResult({ state: "ask" }),
  input: { command: "pwd && git status --short" },
  prompt: {
    source: "tool_call",
    agentName: null,
    message: "Allow tool 'bash'?",
    toolCallId: "tc-1",
    toolName: "bash",
  },
  toolCallId: "tc-1",
};

function config(overrides = {}) {
  return {
    enabled: true,
    provider: "new-provider",
    modelId: "deepseek-v4-flash",
    maxTokens: 256,
    maxRetries: 1,
    fallback: "ask" as const,
    ...overrides,
  };
}

function response(text: string, status = 200): Response {
  return new Response(JSON.stringify({ content: [{ type: "text", text }] }), {
    status,
  });
}

function context(options: { authOk?: boolean; model?: boolean } = {}) {
  const model = {
    id: "deepseek-v4-flash",
    baseUrl: "https://api.example.test",
  };
  return {
    modelRegistry: {
      find: vi.fn(() => (options.model === false ? undefined : model)),
      getApiKeyAndHeaders: vi.fn(async () =>
        options.authOk === false
          ? { ok: false }
          : { ok: true, apiKey: "SECRET_KEY" },
      ),
    },
  } as unknown as ExtensionContext;
}

function makeObserver() {
  const events: ObservedEvent[] = [];
  return {
    events,
    observe: (event: string, details: Record<string, unknown>) => {
      events.push({ event, details });
    },
  };
}

function eventNames(events: readonly ObservedEvent[]): string[] {
  return events.map((entry) => entry.event);
}

describe("autoMode observability", () => {
  it("emits started and allowed without leaking secrets or full prompts", async () => {
    const observer = makeObserver();
    const post = vi.fn(async () => response("<block>no</block>"));
    const decider = new ClassifierAutoAskDecider(
      () => config(),
      context,
      post,
      observer.observe,
    );

    await expect(decider.decide(request)).resolves.toEqual({
      approved: true,
      state: "approved",
      autoApproved: true,
    });

    expect(eventNames(observer.events)).toEqual([
      "auto_mode.started",
      "auto_mode.allowed",
    ]);
    expect(JSON.stringify(observer.events)).not.toContain("SECRET_KEY");
    expect(JSON.stringify(observer.events)).not.toContain(
      "You are a security classifier",
    );
    expect(JSON.stringify(observer.events)).not.toContain(
      "pwd && git status --short",
    );
  });

  it("emits denied with the classifier reason", async () => {
    const observer = makeObserver();
    const post = vi.fn(async () =>
      response("<block>yes</block><reason>danger</reason>"),
    );
    const decider = new ClassifierAutoAskDecider(
      () => config(),
      context,
      post,
      observer.observe,
    );

    await expect(decider.decide(request)).resolves.toMatchObject({
      approved: false,
      denialReason: "danger",
    });

    expect(observer.events.at(-1)).toEqual({
      event: "auto_mode.denied",
      details: expect.objectContaining({ reason: "danger" }),
    });
  });

  it("emits retry, http failure, parse failure, and fallback ask", async () => {
    const observer = makeObserver();
    const post = vi
      .fn()
      .mockResolvedValueOnce(response("server error", 500))
      .mockResolvedValueOnce(response("maybe"));
    const decider = new ClassifierAutoAskDecider(
      () => config({ maxRetries: 1, fallback: "ask" as const }),
      context,
      post,
      observer.observe,
    );

    await expect(decider.decide(request)).resolves.toBeNull();

    expect(eventNames(observer.events)).toEqual([
      "auto_mode.started",
      "auto_mode.http_failure",
      "auto_mode.retry",
      "auto_mode.parse_failure",
      "auto_mode.fallback_ask",
    ]);
  });

  it("emits fallback deny after exhausted retries", async () => {
    const observer = makeObserver();
    const post = vi.fn(async () => response("maybe"));
    const decider = new ClassifierAutoAskDecider(
      () => config({ maxRetries: 0, fallback: "deny" as const }),
      context,
      post,
      observer.observe,
    );

    await expect(decider.decide(request)).resolves.toMatchObject({
      approved: false,
      state: "denied_with_reason",
    });

    expect(eventNames(observer.events)).toEqual([
      "auto_mode.started",
      "auto_mode.parse_failure",
      "auto_mode.fallback_deny",
    ]);
  });

  it("emits setup failure without calling the model", async () => {
    const observer = makeObserver();
    const post = vi.fn(async () => response("<block>no</block>"));
    const decider = new ClassifierAutoAskDecider(
      () => config({ fallback: "ask" as const }),
      () => context({ model: false }),
      post,
      observer.observe,
    );

    await expect(decider.decide(request)).resolves.toBeNull();

    expect(post).not.toHaveBeenCalled();
    expect(eventNames(observer.events)).toEqual([
      "auto_mode.started",
      "auto_mode.setup_failure",
      "auto_mode.fallback_ask",
    ]);
  });
});
