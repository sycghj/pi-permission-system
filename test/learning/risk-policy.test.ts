import { describe, expect, it } from "vitest";
import type { RiskOverrideConfig } from "#src/config-loader";
import type { CapabilityIntent } from "#src/learning/capability-fingerprint";
import { applyRiskOverrides } from "#src/learning/risk-policy";

const dotnetIntent: CapabilityIntent = {
  schemaVersion: 1,
  parserVersion: "learning-v1",
  family: "dotnet-build-test",
  source: "tool_call",
  agentName: "trellis-implement",
  project: { kind: "git-common-dir", id: "git:d:/code/visionnext/.git" },
  projectRelativeCwd: ".",
  operation: {
    kind: "dotnet-build-test",
    subcommand: "test",
    projectPath: "VisionNext.App.Wpf.Tests/VisionNext.App.Wpf.Tests.csproj",
    noRestore: true,
    safeOptions: ["--no-restore"],
  },
  effects: {
    reads: ["VisionNext.App.Wpf.Tests/VisionNext.App.Wpf.Tests.csproj"],
    writes: ["bin", "obj", "TestResults"],
    executesCode: true,
    network: "none",
    secrets: "none",
    remote: false,
  },
  baseRisk: "R2",
  effectiveRisk: "R2",
  coveredGateSurfaces: ["bash"],
};

const override: RiskOverrideConfig = {
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

describe("applyRiskOverrides", () => {
  it("lowers trusted dotnet build/test friction to R1-like", () => {
    expect(applyRiskOverrides(dotnetIntent, [override])).toMatchObject({
      baseRisk: "R2",
      effectiveRisk: "R1",
      appliedRiskOverrideId: "visionnext-dotnet-tests",
    });
  });

  it("does not lower unrelated project identities", () => {
    const unrelated: CapabilityIntent = {
      ...dotnetIntent,
      project: { kind: "git-common-dir", id: "git:d:/code/other/.git" },
    };

    expect(applyRiskOverrides(unrelated, [override])).toMatchObject({
      baseRisk: "R2",
      effectiveRisk: "R2",
    });
  });
});
