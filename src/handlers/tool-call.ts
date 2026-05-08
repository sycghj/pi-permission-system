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
import { describeBashExternalDirectoryGate } from "./gates/bash-external-directory";
import type { GateRunnerDeps } from "./gates/descriptor";
import { isGateBypass } from "./gates/descriptor";
import { describeExternalDirectoryGate } from "./gates/external-directory";
import { runGateCheck } from "./gates/runner";
import { describeSkillReadGate } from "./gates/skill-read";
import { describeToolGate } from "./gates/tool";
import type { ToolCallContext } from "./gates/types";
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
  const { session } = deps;
  session.activate(ctx);

  const agentName = session.resolveAgentName(ctx);
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
  const emitDecision: GateRunnerDeps["emitDecision"] = (e) =>
    emitDecisionEvent(deps.events, e);
  const writeReviewLog = session.logger.review;
  const checkPermission: GateRunnerDeps["checkPermission"] = (
    surface,
    input,
    agent,
    sessionRules,
  ) => session.checkPermission(surface, input, agent, sessionRules);
  const getSessionRuleset = () => session.getSessionRuleset();
  const approveSessionRule = (surface: string, pattern: string) =>
    session.approveSessionRule(surface, pattern);

  // ── Shared runner deps (built once, reused for all gates) ─────────────
  const runnerDeps: GateRunnerDeps = {
    checkPermission,
    getSessionRuleset,
    approveSessionRule,
    writeReviewLog,
    emitDecision,
    canConfirm,
    promptPermission,
  };

  // ── Skill-read gate (descriptor + runner) ────────────────────────────────
  const skillDescriptor = describeSkillReadGate(tcc, () =>
    session.getActiveSkillEntries(),
  );
  if (skillDescriptor) {
    const skillResult = await runGateCheck(
      skillDescriptor,
      tcc.agentName,
      tcc.toolCallId,
      runnerDeps,
    );
    if (skillResult.action === "block") {
      return { block: true, reason: skillResult.reason };
    }
  }

  // ── External-directory gate (descriptor + runner) ─────────────────────────
  const infraDirs = [
    ...session.getInfrastructureDirs(),
    ...session.getInfrastructureReadPaths(),
  ];
  const extDirDesc = describeExternalDirectoryGate(tcc, infraDirs);
  if (extDirDesc) {
    if (isGateBypass(extDirDesc)) {
      if (extDirDesc.log) {
        writeReviewLog(extDirDesc.log.event, extDirDesc.log.details);
      }
      if (extDirDesc.decision) {
        emitDecision(extDirDesc.decision);
      }
    } else {
      const extDirResult = await runGateCheck(
        extDirDesc,
        tcc.agentName,
        tcc.toolCallId,
        runnerDeps,
      );
      if (extDirResult.action === "block") {
        return { block: true, reason: extDirResult.reason };
      }
    }
  }

  // ── Bash external-directory gate (descriptor + runner) ─────────────────────
  const bashExtDesc = await describeBashExternalDirectoryGate(
    tcc,
    checkPermission,
    getSessionRuleset,
  );
  if (bashExtDesc) {
    if (isGateBypass(bashExtDesc)) {
      if (bashExtDesc.log) {
        writeReviewLog(bashExtDesc.log.event, bashExtDesc.log.details);
      }
    } else {
      const bashExtResult = await runGateCheck(
        bashExtDesc,
        tcc.agentName,
        tcc.toolCallId,
        runnerDeps,
      );
      if (bashExtResult.action === "block") {
        return { block: true, reason: bashExtResult.reason };
      }
    }
  }

  // ── Normal tool permission gate (descriptor + runner) ───────────────────────────
  const toolCheck = checkPermission(
    tcc.toolName,
    tcc.input,
    tcc.agentName ?? undefined,
    getSessionRuleset(),
  );
  const toolDescriptor = describeToolGate(tcc, toolCheck);
  toolDescriptor.preCheck = toolCheck;
  const toolResult = await runGateCheck(
    toolDescriptor,
    tcc.agentName,
    tcc.toolCallId,
    runnerDeps,
  );
  if (toolResult.action === "block") {
    return { block: true, reason: toolResult.reason };
  }

  return {};
}
