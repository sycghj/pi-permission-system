import { describe, expect, it } from "vitest";

import {
  type CapabilityIntent,
  capabilityFingerprint,
  gitProjectIdentity,
} from "#src/learning/capability-fingerprint";

const baseIntent: CapabilityIntent = {
  schemaVersion: 1,
  parserVersion: "learning-v1",
  family: "git-diff",
  source: "tool_call",
  agentName: "trellis-code-review",
  project: gitProjectIdentity("D:/code/VisionNext/.git"),
  projectRelativeCwd: ".",
  operation: {
    kind: "git-diff",
    mode: "working-tree",
    revisions: [],
    paths: ["VisionNext.App.Wpf/ViewModels/FlowEditorViewModel.cs"],
  },
  effects: {
    reads: ["VisionNext.App.Wpf/ViewModels/FlowEditorViewModel.cs"],
    writes: [],
    executesCode: false,
    network: "none",
    secrets: "none",
    remote: false,
  },
  baseRisk: "R1",
  effectiveRisk: "R1",
  coveredGateSurfaces: ["bash"],
};

describe("capability fingerprint", () => {
  it("is stable for semantically equal intents with different object key order", () => {
    const reordered: CapabilityIntent = {
      effectiveRisk: "R1",
      baseRisk: "R1",
      effects: {
        remote: false,
        secrets: "none",
        network: "none",
        executesCode: false,
        writes: [],
        reads: ["VisionNext.App.Wpf/ViewModels/FlowEditorViewModel.cs"],
      },
      operation: baseIntent.operation,
      projectRelativeCwd: ".",
      project: gitProjectIdentity("d:/code/visionnext/.git"),
      agentName: "trellis-code-review",
      source: "tool_call",
      family: "git-diff",
      parserVersion: "learning-v1",
      schemaVersion: 1,
      coveredGateSurfaces: ["bash"],
    };

    expect(capabilityFingerprint(baseIntent)).toBe(
      capabilityFingerprint(reordered),
    );
  });

  it("changes when the parser version changes", () => {
    expect(capabilityFingerprint(baseIntent)).not.toBe(
      capabilityFingerprint({ ...baseIntent, parserVersion: "learning-v2" }),
    );
  });

  it("normalizes Windows git common-dir identities", () => {
    expect(gitProjectIdentity("D:/code/VisionNext/.git")).toEqual({
      kind: "git-common-dir",
      id: "git:d:/code/visionnext/.git",
    });
    expect(gitProjectIdentity("D:\\code\\VisionNext\\.git")).toEqual(
      gitProjectIdentity("d:/code/visionnext/.git"),
    );
  });
});
