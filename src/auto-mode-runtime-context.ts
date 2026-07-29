import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutoAskDecisionRequest } from "#src/handlers/gates/auto-ask-decider";
import type { AutoModeRuntimeContext } from "./auto-mode-request";
import { detectWorktreeRuntime } from "./worktree-runtime-context";

export function autoModeRuntimeContext(
  ctx: ExtensionContext,
  request?: Pick<AutoAskDecisionRequest, "agentName" | "input">,
): AutoModeRuntimeContext {
  const worktree = detectWorktreeRuntime({
    cwd: ctx.cwd,
    agentName: request?.agentName,
    input: request?.input,
  });
  return {
    cwd: ctx.cwd,
    ...(worktree
      ? {
          workspace: worktree.workspace,
          pathAliases: worktree.pathAliases,
        }
      : {}),
    entries: safeEntries(ctx),
  };
}

function safeEntries(ctx: ExtensionContext): readonly unknown[] {
  try {
    return ctx.sessionManager.getEntries();
  } catch {
    return [];
  }
}
