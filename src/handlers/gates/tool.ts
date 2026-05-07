import { PATH_BEARING_TOOLS } from "../../external-directory";
import { suggestSessionPattern } from "../../pattern-suggest";
import { applyPermissionGate } from "../../permission-gate";
import {
  formatAskPrompt,
  formatDenyReason,
  formatUserDeniedReason,
} from "../../permission-prompts";
import { getPermissionLogContext } from "../../tool-input-preview";
import { deriveDecisionValue, deriveResolution } from "./helpers";
import type { GateOutcome, ToolCallContext, ToolGateDeps } from "./types";

/**
 * Evaluate the normal tool permission gate.
 *
 * Unlike the other gates this one always applies — it never returns `null`.
 */
export async function evaluateToolGate(
  tcc: ToolCallContext,
  deps: ToolGateDeps,
): Promise<GateOutcome> {
  const check = deps.checkPermission(
    tcc.toolName,
    tcc.input,
    tcc.agentName ?? undefined,
    deps.getSessionRuleset(),
  );

  // Session-hit: already approved by a session rule — skip the gate entirely.
  if (check.source === "session") {
    deps.writeReviewLog("permission_request.session_approved", {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      agentName: tcc.agentName,
      resolution: "session_approved",
      sessionApprovalPattern: check.matchedPattern,
    });
    deps.emitDecision({
      surface: tcc.toolName,
      value: deriveDecisionValue(tcc.toolName, check),
      result: "allow",
      resolution: "session_approved",
      origin: check.origin ?? null,
      agentName: tcc.agentName ?? null,
      matchedPattern: check.matchedPattern ?? null,
    });
    return { action: "allow" };
  }

  const permissionLogContext = getPermissionLogContext(
    check,
    tcc.input,
    PATH_BEARING_TOOLS,
  );

  // Compute session approval suggestion for the "for this session" option.
  const suggestionValue =
    tcc.toolName === "bash"
      ? (check.command ?? "")
      : tcc.toolName === "mcp"
        ? (check.target ?? "mcp")
        : "*";
  const suggestion = suggestSessionPattern(tcc.toolName, suggestionValue);

  // Build the unavailable-reason message. Bash gets the command embedded.
  const inputCommand =
    tcc.toolName === "bash" &&
    typeof (tcc.input as Record<string, unknown>)?.command === "string"
      ? ((tcc.input as Record<string, unknown>).command as string)
      : null;
  const toolUnavailableReason = inputCommand
    ? `Running bash command '${inputCommand}' requires approval, but no interactive UI is available.`
    : tcc.toolName === "mcp"
      ? "Using tool 'mcp' requires approval, but no interactive UI is available."
      : `Using tool '${tcc.toolName}' requires approval, but no interactive UI is available.`;

  const toolAskMessage = formatAskPrompt(
    check,
    tcc.agentName ?? undefined,
    tcc.input,
  );
  const toolCanConfirm = deps.canConfirm();
  let toolDecisionAutoApproved = false;
  const toolGate = await applyPermissionGate({
    state: check.state,
    canConfirm: toolCanConfirm,
    sessionApproval: {
      surface: suggestion.surface,
      pattern: suggestion.pattern,
    },
    promptForApproval: async () => {
      const decision = await deps.promptPermission({
        requestId: tcc.toolCallId,
        source: "tool_call",
        agentName: tcc.agentName,
        message: toolAskMessage,
        toolCallId: tcc.toolCallId,
        toolName: tcc.toolName,
        sessionLabel: suggestion.label,
        ...permissionLogContext,
      });
      toolDecisionAutoApproved = decision.autoApproved === true;
      return decision;
    },
    writeLog: deps.writeReviewLog,
    logContext: {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      agentName: tcc.agentName,
      message: toolAskMessage,
      ...permissionLogContext,
    },
    messages: {
      denyReason: formatDenyReason(check, tcc.agentName ?? undefined),
      unavailableReason: toolUnavailableReason,
      userDeniedReason: (decision) =>
        formatUserDeniedReason(check, decision.denialReason),
    },
  });

  const toolGateHasSession =
    toolGate.action === "allow" && toolGate.sessionApproval !== undefined;
  deps.emitDecision({
    surface: tcc.toolName,
    value: deriveDecisionValue(tcc.toolName, check),
    result: toolGate.action === "allow" ? "allow" : "deny",
    resolution: deriveResolution(
      check.state,
      toolGate.action,
      toolGateHasSession,
      toolCanConfirm,
      toolDecisionAutoApproved,
    ),
    origin: check.origin ?? null,
    agentName: tcc.agentName ?? null,
    matchedPattern: check.matchedPattern ?? null,
  });

  if (toolGate.action === "block") {
    return { action: "block", reason: toolGate.reason };
  }

  if (toolGate.sessionApproval) {
    deps.approveSessionRule(
      toolGate.sessionApproval.surface,
      toolGate.sessionApproval.pattern,
    );
  }

  return { action: "allow" };
}
