import { describe, expect, it } from "vitest";
import { mergeUnifiedConfigs } from "#src/config-loader";

describe("mergeUnifiedConfigs autoMode", () => {
  it("keeps global autoMode when project config omits it", () => {
    const merged = mergeUnifiedConfigs(
      {
        autoMode: {
          enabled: true,
          provider: "new-provider",
          modelId: "deepseek-v4-flash",
          maxTokens: 256,
          maxRetries: 2,
          fallback: "ask",
        },
      },
      {},
    );

    expect(merged.autoMode).toEqual({
      enabled: true,
      provider: "new-provider",
      modelId: "deepseek-v4-flash",
      maxTokens: 256,
      maxRetries: 2,
      fallback: "ask",
    });
  });

  it("lets project autoMode replace global autoMode", () => {
    const merged = mergeUnifiedConfigs(
      {
        autoMode: {
          enabled: false,
          provider: "global-provider",
          modelId: "global-model",
          maxTokens: 256,
          maxRetries: 2,
          fallback: "ask",
        },
      },
      {
        autoMode: {
          enabled: true,
          provider: "project-provider",
          modelId: "project-model",
          maxTokens: 64,
          maxRetries: 4,
          fallback: "deny",
        },
      },
    );

    expect(merged.autoMode).toEqual({
      enabled: true,
      provider: "project-provider",
      modelId: "project-model",
      maxTokens: 64,
      maxRetries: 4,
      fallback: "deny",
    });
  });
});
