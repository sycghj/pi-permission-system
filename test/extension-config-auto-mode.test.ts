import { describe, expect, it } from "vitest";
import { normalizePermissionSystemConfig } from "#src/extension-config";

describe("normalizePermissionSystemConfig autoMode", () => {
  it("defaults to disabled fast classifier settings", () => {
    const result = normalizePermissionSystemConfig({});
    expect(result.autoMode).toEqual({
      enabled: false,
      provider: "new-provider",
      modelId: "deepseek-v4-flash",
      maxTokens: 256,
      maxRetries: 2,
      fallback: "ask",
      twoStage: {
        enabled: false,
        thinkingBudgetTokens: 1024,
      },
    });
    expect(result.learning).toEqual({
      enabled: false,
      mode: "shadow",
      maxTtlMinutes: 120,
      maxUses: 30,
      autoActivateTiers: ["R0", "R1"],
    });
  });

  it("normalizes overrides", () => {
    const result = normalizePermissionSystemConfig({
      autoMode: {
        enabled: true,
        provider: "p",
        modelId: "m",
        maxTokens: 64,
        maxRetries: 4,
        fallback: "deny",
        twoStage: { enabled: true, thinkingBudgetTokens: 2048 },
      },
    });
    expect(result.autoMode).toEqual({
      enabled: true,
      provider: "p",
      modelId: "m",
      maxTokens: 64,
      maxRetries: 4,
      fallback: "deny",
      twoStage: {
        enabled: true,
        thinkingBudgetTokens: 2048,
      },
    });
  });
});
