import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

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
  const { session } = deps;
  session.refreshConfig(ctx);
  session.resetForNewSession(ctx);
  session.logResolvedConfigPaths();

  const agentName = session.resolveAgentName(ctx);
  const policyIssues = session.getConfigIssues(agentName);
  for (const issue of policyIssues) {
    session.logger.warn(issue);
  }

  if (event.reason === "reload") {
    session.logger.debug("lifecycle.reload", {
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

  const { session } = deps;
  session.reload();
  session.logger.debug("lifecycle.reload", {
    triggeredBy: "resources_discover",
    reason: event.reason,
    cwd: session.getRuntimeContext()?.cwd ?? null,
  });
}

export async function handleSessionShutdown(deps: HandlerDeps): Promise<void> {
  const { session } = deps;
  const ctx = session.getRuntimeContext();
  if (ctx) {
    ctx.ui.setStatus(PERMISSION_SYSTEM_STATUS_KEY, undefined);
  }
  session.shutdown();
  deps.stopPermissionRpcHandlers();
}
