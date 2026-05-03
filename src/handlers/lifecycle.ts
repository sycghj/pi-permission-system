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
  deps.runtime.runtimeContext = ctx;
  deps.refreshExtensionConfig(ctx);
  deps.runtime.permissionManager = deps.createPermissionManagerForCwd(ctx.cwd);
  deps.runtime.activeSkillEntries = [];
  deps.runtime.lastActiveToolsCacheKey = null;
  deps.runtime.lastPromptStateCacheKey = null;
  deps.runtime.lastKnownActiveAgentName = getActiveAgentName(ctx);
  deps.startForwardedPermissionPolling(ctx);
  deps.logResolvedConfigPaths();

  const agentName = deps.runtime.lastKnownActiveAgentName;
  const policyIssues =
    deps.runtime.permissionManager.getConfigIssues(agentName);
  for (const issue of policyIssues) {
    deps.notifyWarning(issue);
  }

  if (event.reason === "reload") {
    deps.runtime.writeDebugLog("lifecycle.reload", {
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

  const { runtimeContext } = deps.runtime;
  deps.runtime.permissionManager = deps.createPermissionManagerForCwd(
    runtimeContext?.cwd,
  );
  deps.runtime.activeSkillEntries = [];
  deps.runtime.lastActiveToolsCacheKey = null;
  deps.runtime.lastPromptStateCacheKey = null;
  deps.runtime.writeDebugLog("lifecycle.reload", {
    triggeredBy: "resources_discover",
    reason: event.reason,
    cwd: runtimeContext?.cwd ?? null,
  });
}

export async function handleSessionShutdown(deps: HandlerDeps): Promise<void> {
  const { runtimeContext } = deps.runtime;
  if (runtimeContext) {
    runtimeContext.ui.setStatus(PERMISSION_SYSTEM_STATUS_KEY, undefined);
  }
  deps.runtime.runtimeContext = null;
  deps.runtime.activeSkillEntries = [];
  deps.runtime.lastActiveToolsCacheKey = null;
  deps.runtime.lastPromptStateCacheKey = null;
  deps.runtime.sessionApprovalCache.clear();
  deps.stopForwardedPermissionPolling();
}
