import { toRecord } from "../../common";
import { normalizePathForComparison } from "../../external-directory";
import { emitDecisionEvent } from "../../permission-events";
import { applyPermissionGate } from "../../permission-gate";
import {
  formatSkillPathAskPrompt,
  formatSkillPathDenyReason,
} from "../../permission-prompts";
import { findSkillPathMatch } from "../../skill-prompt-sanitizer";
import type { HandlerDeps } from "../types";
import { deriveResolution } from "./helpers";
import type { GateOutcome, ToolCallContext } from "./types";

/**
 * Evaluate the skill-read permission gate.
 *
 * Returns `null` when the gate does not apply (tool is not `read`, no active
 * skill entries, or the read path does not match any skill).
 */
export async function evaluateSkillReadGate(
  tcc: ToolCallContext,
  deps: HandlerDeps,
): Promise<GateOutcome | null> {
  // Only applies to read tool calls with active skill entries
  if (tcc.toolName !== "read" || deps.runtime.activeSkillEntries.length === 0) {
    return null;
  }

  const inputRecord = toRecord(tcc.input);
  const path = typeof inputRecord.path === "string" ? inputRecord.path : "";
  if (!path) {
    return null;
  }

  const normalizedReadPath = normalizePathForComparison(path, tcc.cwd);
  const matchedSkill = findSkillPathMatch(
    normalizedReadPath,
    deps.runtime.activeSkillEntries,
  );

  if (!matchedSkill) {
    return null;
  }

  const skillReadMessage = formatSkillPathAskPrompt(
    matchedSkill,
    path,
    tcc.agentName ?? undefined,
  );
  const skillReadCanConfirm = deps.canRequestPermissionConfirmation(
    deps.runtime.runtimeContext!,
  );
  const skillReadGate = await applyPermissionGate({
    state: matchedSkill.state,
    canConfirm: skillReadCanConfirm,
    promptForApproval: () =>
      deps.promptPermission(deps.runtime.runtimeContext!, {
        requestId: tcc.toolCallId,
        source: "skill_read",
        agentName: tcc.agentName,
        message: skillReadMessage,
        toolCallId: tcc.toolCallId,
        toolName: tcc.toolName,
        skillName: matchedSkill.name,
        path,
      }),
    writeLog: deps.runtime.writeReviewLog,
    logContext: {
      source: "skill_read",
      skillName: matchedSkill.name,
      agentName: tcc.agentName,
      path,
      message: skillReadMessage,
    },
    messages: {
      denyReason: formatSkillPathDenyReason(
        matchedSkill,
        path,
        tcc.agentName ?? undefined,
      ),
      unavailableReason: `Accessing skill '${matchedSkill.name}' requires approval, but no interactive UI is available.`,
      userDeniedReason: (decision) => {
        const denialReason = decision.denialReason
          ? ` Reason: ${decision.denialReason}.`
          : "";
        return `User denied access to skill '${matchedSkill.name}'.${denialReason}`;
      },
    },
  });

  emitDecisionEvent(deps.events, {
    surface: "skill",
    value: matchedSkill.name,
    result: skillReadGate.action === "allow" ? "allow" : "deny",
    resolution: deriveResolution(
      matchedSkill.state,
      skillReadGate.action,
      false,
      skillReadCanConfirm,
    ),
    origin: null,
    agentName: tcc.agentName ?? null,
    matchedPattern: null,
  });

  if (skillReadGate.action === "block") {
    return { action: "block", reason: skillReadGate.reason };
  }

  return { action: "allow" };
}
