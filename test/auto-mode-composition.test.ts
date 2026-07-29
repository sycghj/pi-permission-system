import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createAutoAskDecider } from "#src/auto-mode-composition";
import type { AutoAskDecisionRequest } from "#src/handlers/gates/auto-ask-decider";
import { makeCheckResult } from "#test/helpers/handler-fixtures";

const request: AutoAskDecisionRequest = {
  agentName: null,
  check: makeCheckResult({ state: "ask" }),
  input: { command: "git status" },
  prompt: {
    source: "tool_call",
    agentName: null,
    message: "Allow tool 'bash'?",
    toolCallId: "tc-1",
    toolName: "bash",
  },
  toolCallId: "tc-1",
};

function response(text: string): Response {
  return new Response(JSON.stringify({ content: [{ type: "text", text }] }));
}

function makeContext() {
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

describe("createAutoAskDecider", () => {
  it("uses current config and runtime context to classify ask decisions", async () => {
    const post = vi.fn(async () => response("<block>no</block>"));
    const events: string[] = [];
    const decider = createAutoAskDecider(
      {
        current: () => ({
          autoMode: {
            enabled: true,
            provider: "new-provider",
            modelId: "deepseek-v4-flash",
            maxTokens: 32,
            maxRetries: 0,
            fallback: "ask",
          },
        }),
      },
      { getRuntimeContext: makeContext },
      post,
      (event) => events.push(event),
    );

    await expect(decider.decide(request)).resolves.toEqual({
      approved: true,
      state: "approved",
      autoApproved: true,
    });
    expect(post).toHaveBeenCalledOnce();
    expect(events).toEqual(["auto_mode.started", "auto_mode.allowed"]);
  });
});
