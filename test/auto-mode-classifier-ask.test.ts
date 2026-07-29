import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ClassifierAutoAskDecider } from "#src/auto-mode-classifier";
import type { AutoAskDecisionRequest } from "#src/handlers/gates/auto-ask-decider";
import { makeCheckResult } from "#test/helpers/handler-fixtures";

const request: AutoAskDecisionRequest = {
  agentName: null,
  check: makeCheckResult({ state: "ask" }),
  input: { command: "write config" },
  prompt: {
    source: "tool_call",
    agentName: null,
    message: "Allow tool 'bash'?",
    toolCallId: "tc-ask",
    toolName: "bash",
  },
  toolCallId: "tc-ask",
};

function config() {
  return {
    enabled: true,
    provider: "new-provider",
    modelId: "deepseek-v4-flash",
    maxTokens: 256,
    maxRetries: 2,
    fallback: "ask" as const,
  };
}

function context(): ExtensionContext {
  return {
    cwd: "F:/code/pi",
    sessionManager: {
      getEntries: () => [{ type: "user", content: "请显式授权这次配置写入" }],
    },
    modelRegistry: {
      find: () => ({
        id: "deepseek-v4-flash",
        baseUrl: "https://api.example.test",
      }),
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "key" }),
    },
  } as unknown as ExtensionContext;
}

describe("ClassifierAutoAskDecider ask fallback", () => {
  it("retries when the classifier returns ask-shaped malformed output", async () => {
    const post = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: "text",
                text: "<ask>yes</ask><reason>needs user</reason>",
              },
            ],
          }),
        ),
    );
    const decider = new ClassifierAutoAskDecider(config, context, post);

    await expect(decider.decide(request)).resolves.toBeNull();
    expect(post).toHaveBeenCalledTimes(3);
  });
});
