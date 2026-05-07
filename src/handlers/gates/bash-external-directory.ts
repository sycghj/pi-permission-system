import { getNonEmptyString, toRecord } from "../../common";
import {
  extractExternalPathsFromBashCommand,
  formatBashExternalDirectoryAskPrompt,
  formatBashExternalDirectoryDenyReason,
  formatExternalDirectoryHardStopHint,
} from "../../external-directory";
import type { PermissionPromptDecision } from "../../permission-dialog";
import { applyPermissionGate } from "../../permission-gate";
import { deriveApprovalPattern } from "../../session-rules";
import type {
  BashExternalDirectoryGateDeps,
  GateOutcome,
  ToolCallContext,
} from "./types";

/**
 * Evaluate the bash external-directory permission gate.
 *
 * Extracts paths from a bash command and checks whether any reference
 * directories outside the working directory. Returns `null` when the gate
 * does not apply (tool is not bash, no CWD, or no external paths found).
 */
export async function evaluateBashExternalDirectoryGate(
  tcc: ToolCallContext,
  deps: BashExternalDirectoryGateDeps,
): Promise<GateOutcome | null> {
  if (tcc.toolName !== "bash" || !tcc.cwd) return null;

  const command = getNonEmptyString(toRecord(tcc.input).command);
  if (!command) return null;

  const externalPaths = await extractExternalPathsFromBashCommand(
    command,
    tcc.cwd,
  );
  if (externalPaths.length === 0) return null;

  const bashSessionRules = deps.getSessionRuleset();
  const uncoveredPaths = externalPaths.filter(
    (p) =>
      deps.checkPermission(
        "external_directory",
        { path: p },
        tcc.agentName ?? undefined,
        bashSessionRules,
      ).source !== "session",
  );

  if (uncoveredPaths.length === 0) {
    deps.writeReviewLog("permission_request.session_approved", {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      agentName: tcc.agentName,
      command,
      externalPaths,
      resolution: "session_approved",
    });
    return null;
  }

  // Get the config-level policy (no path → no session check).
  const extCheck = deps.checkPermission(
    "external_directory",
    {},
    tcc.agentName ?? undefined,
  );

  let bashExtDecision: PermissionPromptDecision | null = null;
  const bashExtMessage = formatBashExternalDirectoryAskPrompt(
    command,
    uncoveredPaths,
    tcc.cwd,
    tcc.agentName ?? undefined,
  );
  const bashExtGate = await applyPermissionGate({
    state: extCheck.state,
    canConfirm: deps.canConfirm(),
    promptForApproval: async () => {
      const decision = await deps.promptPermission({
        requestId: tcc.toolCallId,
        source: "tool_call",
        agentName: tcc.agentName,
        message: bashExtMessage,
        toolCallId: tcc.toolCallId,
        toolName: tcc.toolName,
        command,
      });
      bashExtDecision = decision;
      return decision;
    },
    writeLog: deps.writeReviewLog,
    logContext: {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      agentName: tcc.agentName,
      command,
      externalPaths: uncoveredPaths,
      message: bashExtMessage,
    },
    messages: {
      denyReason: formatBashExternalDirectoryDenyReason(
        command,
        uncoveredPaths,
        tcc.cwd,
        tcc.agentName ?? undefined,
      ),
      unavailableReason: `Bash command '${command}' references path(s) outside the working directory and requires approval, but no interactive UI is available.`,
      userDeniedReason: (decision) => {
        const reasonSuffix = decision.denialReason
          ? ` Reason: ${decision.denialReason}.`
          : "";
        return `User denied external directory access for bash command '${command}'.${reasonSuffix} ${formatExternalDirectoryHardStopHint()}`;
      },
    },
  });

  if (bashExtGate.action === "block") {
    return { action: "block", reason: bashExtGate.reason };
  }

  if (bashExtDecision?.state === "approved_for_session") {
    for (const extPath of uncoveredPaths) {
      const pattern = deriveApprovalPattern(extPath);
      deps.approveSessionRule("external_directory", pattern);
    }
  }

  return { action: "allow" };
}
