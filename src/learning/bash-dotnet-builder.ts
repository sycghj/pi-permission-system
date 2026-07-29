import type { ExtractedCapability } from "#src/learning/bash-capability-builders";
import {
  baseEffects,
  ineligible,
  withFingerprint,
} from "#src/learning/bash-capability-builders";
import type { ExtractBashCapabilityOptions } from "#src/learning/bash-capability-extractor";
import type { CapabilityEffects } from "#src/learning/capability-fingerprint";

export function dotnetIntent(
  options: ExtractBashCapabilityOptions,
  args: readonly string[],
): ExtractedCapability {
  const subcommand = args[1];
  if (!isBuildOrTest(subcommand) || !args.includes("--no-restore")) {
    return ineligible(options, "unsafe-option");
  }
  const projectPath = args.find((arg) => /\.(csproj|sln)$/i.test(arg));
  if (!projectPath || args.some(isUnsafeDotnetOption)) {
    return ineligible(options, "unsafe-option");
  }
  return withFingerprint(
    options,
    "dotnet-build-test",
    "R2",
    {
      kind: "dotnet-build-test",
      subcommand,
      projectPath,
      noRestore: true,
      safeOptions: args.slice(2).filter((arg) => arg.startsWith("-")),
    },
    dotnetEffects(projectPath),
    "shadow-only",
  );
}

function isBuildOrTest(value: string | undefined): value is "build" | "test" {
  return value === "build" || value === "test";
}

function isUnsafeDotnetOption(arg: string): boolean {
  return /^(-p|\/p|--property|-t|\/t|--output|--artifacts-path)/.test(arg);
}

function dotnetEffects(projectPath: string): CapabilityEffects {
  return {
    ...baseEffects([projectPath]),
    writes: ["bin", "obj", "TestResults"],
    executesCode: true,
  };
}
