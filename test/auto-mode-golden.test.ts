import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ClassifierAutoAskDecider } from "#src/auto-mode-classifier";
import type { AutoAskDecisionRequest } from "#src/handlers/gates/auto-ask-decider";
import { makeCheckResult } from "#test/helpers/handler-fixtures";
import {
  type GoldenAutoModeCase,
  goldenAutoModeCases,
} from "./auto-mode-golden-cases";

function config() {
  return {
    enabled: true,
    provider: "new-provider",
    modelId: "deepseek-v4-flash",
    maxTokens: 256,
    maxRetries: 0,
    fallback: "ask" as const,
  };
}

function context() {
  const model = {
    id: "deepseek-v4-flash",
    baseUrl: "https://api.example.test",
  };
  return {
    modelRegistry: {
      find: vi.fn(() => model),
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "key" })),
    },
  } as unknown as ExtensionContext;
}

function request(testCase: GoldenAutoModeCase): AutoAskDecisionRequest {
  return {
    agentName: null,
    check: makeCheckResult({ state: "ask", matchedPattern: "*" }),
    input: testCase.input,
    prompt: {
      source: "tool_call",
      agentName: null,
      message: `User intent: ${testCase.userIntent}. Allow tool '${testCase.toolName}'?`,
      toolCallId: testCase.id,
      toolName: testCase.toolName,
    },
    toolCallId: testCase.id,
  };
}

function response(block: boolean): Response {
  const text = block
    ? "<block>yes</block><reason>golden block</reason>"
    : "<block>no</block>";
  return new Response(JSON.stringify({ content: [{ type: "text", text }] }));
}

function body(init: RequestInit): Record<string, unknown> {
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

function userContent(payload: Record<string, unknown>): string {
  const messages = payload.messages;
  expect(messages).toEqual(expect.any(Array));
  const first = (messages as Array<{ content: string }>)[0];
  return first.content;
}

function categories(): Set<string> {
  return new Set(goldenAutoModeCases.map((item) => item.category));
}

function ids(): string[] {
  return goldenAutoModeCases.map((item) => item.id);
}

describe("autoMode golden classifier cases", () => {
  it("defines at least 100 ask-branch cases with stable ids and required fields", () => {
    expect(goldenAutoModeCases.length).toBeGreaterThanOrEqual(100);
    expect(new Set(ids()).size).toBe(goldenAutoModeCases.length);
    for (const testCase of goldenAutoModeCases) {
      expect(testCase.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(testCase.category.length).toBeGreaterThan(0);
      expect(testCase.toolName.length).toBeGreaterThan(0);
      expect(Object.keys(testCase.input).length).toBeGreaterThan(0);
      expect(testCase.userIntent.length).toBeGreaterThan(0);
      expect(testCase.expectPromptIncludes.length).toBeGreaterThan(0);
    }
  });

  it("covers required ask-branch risk categories", () => {
    expect(categories()).toEqual(
      new Set([
        "safe read-only",
        "sensitive path",
        "dangerous bash",
        "git destructive",
        "external code/network",
        "user authorization",
        "auto-mode bypass",
        "self-modification",
        "external system writes",
        "safe local write",
        "safe local build",
        "ambiguous user intent",
        "permission escalation",
        "package manager mutation",
        "secret exfiltration",
        "destructive filesystem",
        "subprocess persistence",
        "external directory",
        "session state mutation",
        "safe inspection with filters",
      ]),
    );
  });

  it.each(
    goldenAutoModeCases,
  )("classifies $id using a structured ask-decision prompt", async (testCase) => {
    const post = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = body(init);
      const content = userContent(payload);
      expect(String(payload.system)).toContain("HARD BLOCK");
      expect(String(payload.system)).toContain("SOFT BLOCK");
      expect(String(payload.system)).toContain("ALLOW");
      expect(content).toContain("Ask decision context:");
      expect(content).toContain("User intent:");
      expect(content).toContain(testCase.userIntent);
      expect(content).toContain(testCase.expectPromptIncludes);
      return response(testCase.expectBlock);
    });
    const decider = new ClassifierAutoAskDecider(config, context, post);

    const decision = await decider.decide(request(testCase));

    expect(decision?.approved).toBe(!testCase.expectBlock);
    expect(post).toHaveBeenCalledOnce();
  });
});
