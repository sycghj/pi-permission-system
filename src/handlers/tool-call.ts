import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import { toRecord } from "../common";
import { emitDecisionEvent } from "../permission-events";
import {
  formatMissingToolNameReason,
  formatUnknownToolReason,
} from "../permission-prompts";
import {
  checkRequestedToolRegistration,
  getToolNameFromValue,
} from "../tool-registry";
import { evaluateBashExternalDirectoryGate } from "./gates/bash-external-directory";
import { evaluateExternalDirectoryGate } from "./gates/external-directory";
import { evaluateSkillReadGate } from "./gates/skill-read";
import { evaluateToolGate } from "./gates/tool";
import type {
  BashExternalDirectoryGateDeps,
  ExternalDirectoryGateDeps,
  SkillReadGateDeps,
  ToolCallContext,
  ToolGateDeps,
} from "./gates/types";
import type { HandlerDeps, PromptPermissionDetails } from "./types";

/**
 * Extract the tool input from an event, checking both `input` and `arguments`
 * fields (different Pi SDK versions use different names).
 */
export function getEventInput(event: unknown): unknown {
  const record = toRecord(event);

  if (record.input !== undefined) {
    return record.input;
  }

  if (record.arguments !== undefined) {
    return record.arguments;
  }

  return {};
}

export async function handleToolCall(
  deps: HandlerDeps,
  event: unknown,
  ctx: ExtensionContext,
): Promise<{ block?: true; reason?: string }> {
  deps.runtime.runtimeContext = ctx;
  deps.startForwardedPermissionPolling(ctx);

  const agentName = deps.resolveAgentName(ctx);
  const toolName = getToolNameFromValue(event);

  if (!toolName) {
    return { block: true, reason: formatMissingToolNameReason() };
  }

  const registrationCheck = checkRequestedToolRegistration(
    toolName,
    deps.getAllTools(),
  );
  if (registrationCheck.status === "missing-tool-name") {
    return { block: true, reason: formatMissingToolNameReason() };
  }

  if (registrationCheck.status === "unregistered") {
    return {
      block: true,
      reason: formatUnknownToolReason(
        registrationCheck.requestedToolName,
        registrationCheck.availableToolNames,
      ),
    };
  }

  const input = getEventInput(event);
  const toolCallId =
    typeof (event as Record<string, unknown>).toolCallId === "string"
      ? ((event as Record<string, unknown>).toolCallId as string)
      : "";

  const tcc: ToolCallContext = {
    toolName,
    agentName,
    input,
    toolCallId,
    cwd: ctx.cwd,
  };

  // ── Shared gate adapter closures ───────────────────────────────────────
  const canConfirm = () => deps.canRequestPermissionConfirmation(ctx);
  const promptPermission = (details: PromptPermissionDetails) =>
    deps.promptPermission(ctx, details);
  const emitDecision = (e: Parameters<ToolGateDeps["emitDecision"]>[0]) =>
    emitDecisionEvent(deps.events, e);
  const { writeReviewLog } = deps.runtime;
  const checkPermission: ToolGateDeps["checkPermission"] = (
    surface,
    input,
    agent,
    sessionRules,
  ) =>
    deps.runtime.permissionManager.checkPermission(
      surface,
      input,
      agent,
      sessionRules,
    );
  const getSessionRuleset = () => deps.runtime.sessionRules.getRuleset();
  const approveSessionRule = (surface: string, pattern: string) =>
    deps.runtime.sessionRules.approve(surface, pattern);

  // ── Skill-read gate ──────────────────────────────────────────────────────
  const skillReadGateDeps: SkillReadGateDeps = {
    getActiveSkillEntries: () => deps.runtime.activeSkillEntries,
    writeReviewLog,
    emitDecision,
    canConfirm,
    promptPermission,
  };
  const skillResult = await evaluateSkillReadGate(tcc, skillReadGateDeps);
  if (skillResult?.action === "block") {
    return { block: true, reason: skillResult.reason };
  }

  // ── External-directory gate (file tools) ─────────────────────────────────
  const extDirGateDeps: ExternalDirectoryGateDeps = {
    checkPermission,
    getSessionRuleset,
    approveSessionRule,
    writeReviewLog,
    emitDecision,
    canConfirm,
    promptPermission,
    getInfrastructureDirs: () => [
      ...deps.runtime.piInfrastructureDirs,
      ...(deps.runtime.config.piInfrastructureReadPaths ?? []),
    ],
  };
  const extDirResult = await evaluateExternalDirectoryGate(tcc, extDirGateDeps);
  if (extDirResult?.action === "block") {
    return { block: true, reason: extDirResult.reason };
  }

  // ── Bash external-directory gate ─────────────────────────────────────────
  const bashExtGateDeps: BashExternalDirectoryGateDeps = {
    checkPermission,
    getSessionRuleset,
    approveSessionRule,
    writeReviewLog,
    canConfirm,
    promptPermission,
  };
  const bashExtResult = await evaluateBashExternalDirectoryGate(
    tcc,
    bashExtGateDeps,
  );
  if (bashExtResult?.action === "block") {
    return { block: true, reason: bashExtResult.reason };
  }

  // ── Normal tool permission gate ──────────────────────────────────────────
  const toolGateDeps: ToolGateDeps = {
    checkPermission,
    getSessionRuleset,
    approveSessionRule,
    writeReviewLog,
    emitDecision,
    canConfirm,
    promptPermission,
  };
  const toolResult = await evaluateToolGate(tcc, toolGateDeps);
  if (toolResult.action === "block") {
    return { block: true, reason: toolResult.reason };
  }

  return {};
}
