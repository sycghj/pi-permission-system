import type {
  BeforeAgentStartEventResult,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";

/** Minimal subset of BeforeAgentStartEvent used by this handler. */
interface BeforeAgentStartPayload {
  systemPrompt: string;
}

import {
  createActiveToolsCacheKey,
  createBeforeAgentStartPromptStateKey,
  shouldApplyCachedAgentStartState,
} from "../before-agent-start-cache";
import type { PermissionManager } from "../permission-manager";
import { resolveSkillPromptEntries } from "../skill-prompt-sanitizer";
import { sanitizeAvailableToolsSection } from "../system-prompt-sanitizer";
import { getToolNameFromValue } from "../tool-registry";
import type { HandlerDeps } from "./types";

/**
 * Pure helper: returns true when the tool should be exposed to the agent.
 * Checks the tool-level permission (not command-level) so that a blanket
 * `bash: deny` hides the tool entirely before any invocation is attempted.
 */
export function shouldExposeTool(
  toolName: string,
  agentName: string | null,
  permissionManager: PermissionManager,
): boolean {
  const toolPermission = permissionManager.getToolPermission(
    toolName,
    agentName ?? undefined,
  );
  return toolPermission !== "deny";
}

export async function handleBeforeAgentStart(
  deps: HandlerDeps,
  event: BeforeAgentStartPayload,
  ctx: ExtensionContext,
): Promise<BeforeAgentStartEventResult> {
  deps.session.runtimeContext = ctx;
  deps.refreshExtensionConfig(ctx);
  deps.forwarding.start(ctx);

  const agentName = deps.resolveAgentName(ctx, event.systemPrompt);
  const { permissionManager } = deps.session;
  const allTools = deps.getAllTools();
  const allowedTools: string[] = [];

  for (const tool of allTools) {
    const toolName = getToolNameFromValue(tool);
    if (!toolName) {
      continue;
    }
    if (shouldExposeTool(toolName, agentName, permissionManager)) {
      allowedTools.push(toolName);
    }
  }

  const activeToolsCacheKey = createActiveToolsCacheKey(allowedTools);
  if (
    shouldApplyCachedAgentStartState(
      deps.session.lastActiveToolsCacheKey,
      activeToolsCacheKey,
    )
  ) {
    deps.setActiveTools(allowedTools);
    deps.session.lastActiveToolsCacheKey = activeToolsCacheKey;
  }

  const promptStateCacheKey = createBeforeAgentStartPromptStateKey({
    agentName,
    cwd: ctx.cwd,
    permissionStamp: permissionManager.getPolicyCacheStamp(
      agentName ?? undefined,
    ),
    systemPrompt: event.systemPrompt,
    allowedToolNames: allowedTools,
  });

  if (
    !shouldApplyCachedAgentStartState(
      deps.session.lastPromptStateCacheKey,
      promptStateCacheKey,
    )
  ) {
    return {};
  }

  deps.session.lastPromptStateCacheKey = promptStateCacheKey;

  const toolPromptResult = sanitizeAvailableToolsSection(
    event.systemPrompt,
    allowedTools,
  );
  const skillPromptResult = resolveSkillPromptEntries(
    toolPromptResult.prompt,
    permissionManager,
    agentName,
    ctx.cwd,
  );
  deps.session.activeSkillEntries = skillPromptResult.entries;

  if (skillPromptResult.prompt !== event.systemPrompt) {
    return { systemPrompt: skillPromptResult.prompt };
  }

  return {};
}
