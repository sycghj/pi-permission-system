import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import { getActiveAgentName } from "../active-agent";
import { PERMISSION_SYSTEM_STATUS_KEY } from "../status";
import type { HandlerDeps } from "./types";

/** Minimal subset of SessionStartEvent used by this handler. */
interface SessionStartPayload {
  reason: string;
}

/** Minimal subset of ResourcesDiscoverEvent used by this handler. */
interface ResourcesDiscoverPayload {
  reason: string;
}

export async function handleSessionStart(
  deps: HandlerDeps,
  event: SessionStartPayload,
  ctx: ExtensionContext,
): Promise<void> {
  deps.setRuntimeContext(ctx);
  deps.refreshExtensionConfig(ctx);
  deps.setPermissionManager(deps.createPermissionManagerForCwd(ctx.cwd));
  deps.setActiveSkillEntries([]);
  deps.setLastActiveToolsCacheKey(null);
  deps.setLastPromptStateCacheKey(null);
  deps.setLastKnownActiveAgentName(getActiveAgentName(ctx));
  deps.startForwardedPermissionPolling(ctx);
  deps.logResolvedConfigPaths();

  const agentName = deps.getLastKnownActiveAgentName();
  const policyIssues = deps.getPermissionManager().getConfigIssues(agentName);
  for (const issue of policyIssues) {
    deps.notifyWarning(issue);
  }

  if (event.reason === "reload") {
    deps.writeDebugLog("lifecycle.reload", {
      triggeredBy: "session_start",
      reason: event.reason,
      cwd: ctx.cwd,
    });
  }
}

export async function handleResourcesDiscover(
  deps: HandlerDeps,
  event: ResourcesDiscoverPayload,
): Promise<void> {
  if (event.reason !== "reload") {
    return;
  }

  const runtimeContext = deps.getRuntimeContext();
  deps.setPermissionManager(
    deps.createPermissionManagerForCwd(runtimeContext?.cwd),
  );
  deps.setActiveSkillEntries([]);
  deps.setLastActiveToolsCacheKey(null);
  deps.setLastPromptStateCacheKey(null);
  deps.writeDebugLog("lifecycle.reload", {
    triggeredBy: "resources_discover",
    reason: event.reason,
    cwd: runtimeContext?.cwd ?? null,
  });
}

export async function handleSessionShutdown(deps: HandlerDeps): Promise<void> {
  const ctx = deps.getRuntimeContext();
  if (ctx) {
    ctx.ui.setStatus(PERMISSION_SYSTEM_STATUS_KEY, undefined);
  }
  deps.setRuntimeContext(null);
  deps.setActiveSkillEntries([]);
  deps.setLastActiveToolsCacheKey(null);
  deps.setLastPromptStateCacheKey(null);
  deps.sessionApprovalCache.clear();
  deps.stopForwardedPermissionPolling();
}
