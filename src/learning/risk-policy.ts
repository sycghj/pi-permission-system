import type { RiskOverrideConfig } from "#src/config-loader";
import type { CapabilityIntent } from "#src/learning/capability-fingerprint";

export type RiskAdjustedCapabilityIntent = CapabilityIntent & {
  readonly appliedRiskOverrideId?: string;
};

export function applyRiskOverrides(
  intent: CapabilityIntent,
  overrides: readonly RiskOverrideConfig[],
): RiskAdjustedCapabilityIntent {
  const override = overrides.find((candidate) =>
    matchesOverride(intent, candidate),
  );
  if (!override) return intent;
  return {
    ...intent,
    effectiveRisk: override.to,
    appliedRiskOverrideId: override.id,
  };
}

function matchesOverride(
  intent: CapabilityIntent,
  override: RiskOverrideConfig,
): boolean {
  if (intent.family !== override.capability) return false;
  if (intent.baseRisk !== override.from) return false;
  if (intent.project?.id !== override.scope.projectIdentity) return false;
  if (!override.scope.sources.includes(intent.source)) return false;
  if (!agentMatches(intent.agentName, override.scope.agents)) return false;
  return matchesDotnetConstraints(intent, override);
}

function agentMatches(
  agentName: string | null,
  agents: readonly string[],
): boolean {
  return agentName !== null && agents.includes(agentName);
}

function matchesDotnetConstraints(
  intent: CapabilityIntent,
  override: RiskOverrideConfig,
): boolean {
  const operation = intent.operation;
  if (operation.kind !== "dotnet-build-test") return false;
  if (!override.constraints.subcommands.includes(operation.subcommand)) {
    return false;
  }
  if (
    !matchesAnyPath(operation.projectPath, override.constraints.projectPaths)
  ) {
    return false;
  }
  return operation.safeOptions.every((option) =>
    override.constraints.safeOptions.includes(option),
  );
}

function matchesAnyPath(
  pathValue: string,
  patterns: readonly string[],
): boolean {
  return patterns.some((pattern) => matchesPath(pathValue, pattern));
}

function matchesPath(pathValue: string, pattern: string): boolean {
  const normalizedPath = normalizePath(pathValue);
  const normalizedPattern = normalizePath(pattern);
  if (normalizedPattern.endsWith("/**")) {
    return normalizedPath.startsWith(normalizedPattern.slice(0, -3));
  }
  return normalizedPath === normalizedPattern;
}

function normalizePath(pathValue: string): string {
  return pathValue.replaceAll("\\", "/").toLowerCase();
}
