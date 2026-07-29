import type { ExtractBashCapabilityOptions } from "#src/learning/bash-capability-extractor";
import type {
  CapabilityEffects,
  CapabilityIntent,
  RiskTier,
} from "#src/learning/capability-fingerprint";
import {
  capabilityFingerprint,
  hashText,
} from "#src/learning/capability-fingerprint";

const PARSER_VERSION = "learning-v1";

export type IneligibleReason =
  | "unknown-capability"
  | "shell-composition"
  | "wrapper"
  | "unsafe-option"
  | "shadow-only";

export type ExtractedCapability = CapabilityIntent & {
  readonly fingerprint: string;
  readonly eligible:
    | { readonly active: true }
    | { readonly active: false; readonly reason: IneligibleReason };
};

export function buildIntent(
  options: ExtractBashCapabilityOptions,
  args: readonly string[],
): ExtractedCapability {
  if (args.length === 1 && args[0] === "pwd") return pwdIntent(options);
  if (args[0] === "git") return gitIntent(options, args);
  if (args[0] === "rg") return rgIntent(options, args);
  if (args[0] === "sed") return sedIntent(options, args);
  return ineligible(options, "unknown-capability");
}

export function ineligible(
  options: ExtractBashCapabilityOptions,
  reason: IneligibleReason,
): ExtractedCapability {
  return withFingerprint(
    options,
    "pwd",
    "R4",
    { kind: "pwd" },
    baseEffects(),
    reason,
  );
}

function pwdIntent(options: ExtractBashCapabilityOptions): ExtractedCapability {
  return withFingerprint(options, "pwd", "R0", { kind: "pwd" }, baseEffects());
}

function gitIntent(
  options: ExtractBashCapabilityOptions,
  args: readonly string[],
): ExtractedCapability {
  if (args[1] !== "diff" || hasUnsafeGitOption(args)) {
    return ineligible(options, "unsafe-option");
  }
  const paths = args.includes("--") ? args.slice(args.indexOf("--") + 1) : [];
  return withFingerprint(
    options,
    "git-diff",
    "R1",
    {
      kind: "git-diff",
      mode: gitDiffMode(args),
      revisions: [],
      paths,
    },
    baseEffects(paths),
  );
}

function hasUnsafeGitOption(args: readonly string[]): boolean {
  return args.some((arg, index) => {
    if (arg === "-c" || arg === "--no-index" || arg === "--ext-diff")
      return true;
    return index > 1 && arg.startsWith("--output");
  });
}

function gitDiffMode(
  args: readonly string[],
): "working-tree" | "staged" | "stat" {
  if (args.includes("--cached") || args.includes("--staged")) return "staged";
  if (args.includes("--stat")) return "stat";
  return "working-tree";
}

function rgIntent(
  options: ExtractBashCapabilityOptions,
  args: readonly string[],
): ExtractedCapability {
  if (args.some((arg) => arg === "--pre" || arg === "--follow")) {
    return ineligible(options, "unsafe-option");
  }
  const [pattern = "", ...roots] = args
    .slice(1)
    .filter((arg) => !arg.startsWith("-"));
  return withFingerprint(
    options,
    "ripgrep-search",
    "R1",
    {
      kind: "ripgrep-search",
      patternHash: hashText(pattern),
      roots,
      safeOptions: args.slice(1).filter((arg) => arg.startsWith("-")),
    },
    baseEffects(roots),
  );
}

function sedIntent(
  options: ExtractBashCapabilityOptions,
  args: readonly string[],
): ExtractedCapability {
  if (args.includes("-i") || args.some(isUnsafeSedScript)) {
    return ineligible(options, "unsafe-option");
  }
  const inputPaths = args
    .slice(1)
    .filter((arg) => !arg.startsWith("-"))
    .slice(1);
  return withFingerprint(
    options,
    "sed-stdout",
    "R1",
    {
      kind: "sed-stdout",
      scriptHash: hashText(args.find((arg) => !arg.startsWith("-")) ?? ""),
      inputPaths,
    },
    baseEffects(inputPaths),
    "shadow-only",
  );
}

function isUnsafeSedScript(arg: string): boolean {
  return /(^|[;\s])\d*e(\s|$)/.test(arg) || /(^|[;\s])\d*w\s+/.test(arg);
}

export function withFingerprint(
  options: ExtractBashCapabilityOptions,
  family: CapabilityIntent["family"],
  risk: RiskTier,
  operation: CapabilityIntent["operation"],
  effects: CapabilityEffects,
  inactiveReason?: IneligibleReason,
): ExtractedCapability {
  const intent = baseIntent(options, family, risk, operation, effects);
  const eligible = inactiveReason
    ? { active: false as const, reason: inactiveReason }
    : { active: true as const };
  return { ...intent, fingerprint: capabilityFingerprint(intent), eligible };
}

function baseIntent(
  options: ExtractBashCapabilityOptions,
  family: CapabilityIntent["family"],
  risk: RiskTier,
  operation: CapabilityIntent["operation"],
  effects: CapabilityEffects,
): CapabilityIntent {
  return {
    schemaVersion: 1,
    parserVersion: PARSER_VERSION,
    family,
    source: options.source,
    agentName: options.agentName,
    project: options.projectIdentity,
    projectRelativeCwd: ".",
    operation,
    effects,
    baseRisk: risk,
    effectiveRisk: risk,
    coveredGateSurfaces: ["bash"],
  };
}

export function baseEffects(reads: readonly string[] = []): CapabilityEffects {
  return {
    reads,
    writes: [],
    executesCode: false,
    network: "none",
    secrets: "none",
    remote: false,
  };
}
