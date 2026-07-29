import { createHash } from "node:crypto";

export type RiskTier = "R0" | "R1" | "R2" | "R3" | "R4";
export type CapabilityFamily =
  | "pwd"
  | "git-diff"
  | "ripgrep-search"
  | "sed-stdout"
  | "dotnet-build-test";

export interface ProjectIdentity {
  readonly kind: "git-common-dir";
  readonly id: `git:${string}`;
}

export interface CapabilityEffects {
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly executesCode: boolean;
  readonly network: "none" | "not-requested" | "possible";
  readonly secrets: "none" | "possible";
  readonly remote: boolean;
}

export type CapabilityOperation =
  | { readonly kind: "pwd" }
  | {
      readonly kind: "git-diff";
      readonly mode: "working-tree" | "staged" | "commit-range" | "stat";
      readonly revisions: readonly string[];
      readonly paths: readonly string[];
    }
  | {
      readonly kind: "ripgrep-search";
      readonly patternHash: string;
      readonly roots: readonly string[];
      readonly safeOptions: readonly string[];
    }
  | {
      readonly kind: "sed-stdout";
      readonly scriptHash: string;
      readonly inputPaths: readonly string[];
    }
  | {
      readonly kind: "dotnet-build-test";
      readonly subcommand: "build" | "test";
      readonly projectPath: string;
      readonly noRestore: true;
      readonly safeOptions: readonly string[];
    };

export interface CapabilityIntent {
  readonly schemaVersion: 1;
  readonly parserVersion: string;
  readonly family: CapabilityFamily;
  readonly source: "tool_call" | "user_bash";
  readonly agentName: string | null;
  readonly project?: ProjectIdentity;
  readonly projectRelativeCwd?: string;
  readonly operation: CapabilityOperation;
  readonly effects: CapabilityEffects;
  readonly baseRisk: RiskTier;
  readonly effectiveRisk: RiskTier;
  readonly coveredGateSurfaces: readonly (
    | "bash"
    | "path"
    | "external_directory"
  )[];
}

export function capabilityFingerprint(intent: CapabilityIntent): string {
  const hash = createHash("sha256");
  hash.update(stableJson(intent));
  return `sha256:${hash.digest("hex")}`;
}

export function gitProjectIdentity(commonDir: string): ProjectIdentity {
  return {
    kind: "git-common-dir",
    id: `git:${normalizeCommonDir(commonDir)}`,
  };
}

export function hashText(value: string): string {
  const hash = createHash("sha256");
  hash.update(value);
  return `sha256:${hash.digest("hex")}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeCommonDir(pathValue: string): string {
  return pathValue.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}
