import type { BashProgram } from "#src/access-intent/bash/program";
import type { IneligibleReason } from "#src/learning/bash-capability-builders";

export function hardReject(program: BashProgram): IneligibleReason | undefined {
  const commands = program.commands();
  if (commands.some((command) => command.wrapperKind)) return "wrapper";
  if (commands.length !== 1) return "shell-composition";
  if (/[>|&;]/.test(program.commandText())) return "shell-composition";
  if (/^\s*\w+=/.test(program.commandText())) return "unsafe-option";
  return undefined;
}

export function tokenizeCommand(text: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+)/g;
  let match = pattern.exec(text);
  while (match) {
    tokens.push(match[1] || match[2] || match[3]);
    match = pattern.exec(text);
  }
  return tokens;
}
