import type { AutoAskDecisionRequest } from "#src/handlers/gates/auto-ask-decider";
import type { AutoModeRuntimeContext } from "./auto-mode-runtime-summary";

export function capabilitySummary(
  request: AutoAskDecisionRequest,
  runtime?: AutoModeRuntimeContext,
): string {
  const lines = [
    "Capability projection:",
    `Surface: ${request.check.toolName}`,
    `Operation: ${operation(request)}`,
    `Effects: ${effects(request)}`,
  ];
  if (request.check.command) lines.push(`Command: ${request.check.command}`);
  if (runtime?.cwd) lines.push(`Workdir: ${runtime.cwd}`);
  return lines.join("\n");
}

function operation(request: AutoAskDecisionRequest): string {
  return request.check.toolName === "bash" ? "shell-command" : "tool-call";
}

function effects(request: AutoAskDecisionRequest): string {
  if (request.check.toolName !== "bash") return "unknown";
  const command = request.check.command ?? "";
  return isReadOnlyLocalCommand(command) ? "read-only, local" : "unknown";
}

function isReadOnlyLocalCommand(command: string): boolean {
  return /^(git\s+(status|diff|log|show)\b|pwd\b|ls\b|rg\b)/.test(command);
}
