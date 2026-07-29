import type { BashProgram } from "#src/access-intent/bash/program";
import {
  buildIntent,
  type ExtractedCapability,
  ineligible,
} from "#src/learning/bash-capability-builders";
import { hardReject, tokenizeCommand } from "#src/learning/bash-command-shape";
import { dotnetIntent } from "#src/learning/bash-dotnet-builder";
import type { ProjectIdentity } from "#src/learning/capability-fingerprint";

export interface ExtractBashCapabilityOptions {
  readonly program: BashProgram;
  readonly cwd: string;
  readonly source: "tool_call" | "user_bash";
  readonly agentName: string | null;
  readonly projectIdentity?: ProjectIdentity;
}

export type { ExtractedCapability };

export function extractBashCapability(
  options: ExtractBashCapabilityOptions,
): ExtractedCapability {
  const hard = hardReject(options.program);
  if (hard) return ineligible(options, hard);

  const command = options.program.commands()[0]?.text ?? "";
  const args = tokenizeCommand(command);
  return args[0] === "dotnet"
    ? dotnetIntent(options, args)
    : buildIntent(options, args);
}
