import { describe, expect, it } from "vitest";
import { unifiedConfigSchema } from "#src/config-schema";

describe("unifiedConfigSchema autoMode", () => {
  it("accepts classifier runtime knobs", () => {
    const result = unifiedConfigSchema.safeParse({
      autoMode: {
        enabled: true,
        provider: "new-provider",
        modelId: "deepseek-v4-flash",
        maxTokens: 256,
        maxRetries: 2,
        fallback: "ask",
        twoStage: {
          enabled: true,
          thinkingBudgetTokens: 1024,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid classifier knobs", () => {
    expect(
      unifiedConfigSchema.safeParse({ autoMode: { maxTokens: 0 } }).success,
    ).toBe(false);
    expect(
      unifiedConfigSchema.safeParse({ autoMode: { provider: 42 } }).success,
    ).toBe(false);
    expect(
      unifiedConfigSchema.safeParse({ autoMode: { maxRetries: -1 } }).success,
    ).toBe(false);
    expect(
      unifiedConfigSchema.safeParse({ autoMode: { fallback: "allow" } })
        .success,
    ).toBe(false);
    expect(
      unifiedConfigSchema.safeParse({
        autoMode: { twoStage: { thinkingBudgetTokens: 0 } },
      }).success,
    ).toBe(false);
  });
});

describe("unifiedConfigSchema learning", () => {
  it("accepts learned capability grants MVP config", () => {
    const result = unifiedConfigSchema.safeParse({
      learning: {
        enabled: true,
        mode: "shadow",
        maxTtlMinutes: 120,
        maxUses: 30,
        autoActivateTiers: ["R0", "R1"],
      },
      riskOverrides: [trustedDotnetOverride()],
    });

    expect(result.success).toBe(true);
  });

  it("rejects broad dotnet risk lowering", () => {
    const result = unifiedConfigSchema.safeParse({
      riskOverrides: [
        {
          ...trustedDotnetOverride(),
          id: "bad-dotnet-star",
          to: "R0",
          capability: "dotnet *",
          constraints: {},
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});

function trustedDotnetOverride() {
  return {
    id: "visionnext-dotnet-tests",
    name: "VisionNext trusted dotnet tests",
    from: "R2",
    to: "R1",
    capability: "dotnet-build-test",
    scope: {
      projectIdentity: "git:d:/code/visionnext/.git",
      agents: ["trellis-implement"],
      sources: ["tool_call"],
      sameRepoWorktrees: true,
    },
    constraints: {
      subcommands: ["build", "test"],
      projectPaths: ["VisionNext.App.Wpf.Tests/**"],
      requireExplicitProjectPath: true,
      requireNoRestore: true,
      allowWrites: ["bin/**", "obj/**", "TestResults/**"],
      denyCommandRequestedNetwork: true,
      denySecrets: true,
      safeOptions: ["--no-restore"],
    },
    ttlMinutes: 120,
    maxUses: 20,
  };
}
