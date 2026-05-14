import { getPathBearingToolPath } from "../../path-utils";
import { deriveApprovalPattern } from "../../session-rules";
import type { PermissionCheckResult } from "../../types";
import type { GateDescriptor, GateResult } from "./descriptor";
import type { ToolCallContext } from "./types";

/** Function type for checkPermission used by the descriptor factory. */
type CheckPermissionFn = (
  surface: string,
  input: unknown,
  agentName?: string,
) => PermissionCheckResult;

/**
 * Build a pure descriptor for the cross-cutting path permission gate (tools).
 *
 * Returns `null` when the gate does not apply (tool is not path-bearing,
 * no extractable path, or the `path` surface evaluates to `allow`).
 * Returns a `GateDescriptor` when the path matches a `deny` or `ask` rule.
 */
export function describePathGate(
  tcc: ToolCallContext,
  checkPermission: CheckPermissionFn,
): GateResult {
  const filePath = getPathBearingToolPath(tcc.toolName, tcc.input);
  if (!filePath) return null;

  const check = checkPermission(
    "path",
    { path: filePath },
    tcc.agentName ?? undefined,
  );

  if (check.state === "allow") return null;

  const pattern = deriveApprovalPattern(filePath);

  const descriptor: GateDescriptor = {
    surface: "path",
    input: { path: filePath },
    messages: {
      denyReason: formatPathDenyReason(
        tcc.toolName,
        filePath,
        tcc.agentName ?? undefined,
      ),
      unavailableReason: `Accessing '${filePath}' requires approval, but no interactive UI is available.`,
      userDeniedReason: (decision) => {
        const reasonSuffix = decision.denialReason
          ? ` Reason: ${decision.denialReason}.`
          : "";
        return `User denied access to path '${filePath}'.${reasonSuffix} Hard stop: this path permission denial is policy-enforced. Do not retry this path, do not attempt a filesystem bypass, and report the block to the user.`;
      },
    },
    sessionApproval: {
      surface: "path",
      pattern,
    },
    promptDetails: {
      source: "tool_call",
      agentName: tcc.agentName,
      message: formatPathAskPrompt(
        tcc.toolName,
        filePath,
        tcc.agentName ?? undefined,
      ),
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      path: filePath,
    },
    logContext: {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      agentName: tcc.agentName,
      path: filePath,
    },
    decision: {
      surface: "path",
      value: filePath,
    },
    preCheck: check,
  };

  return descriptor;
}

export function formatPathDenyReason(
  toolName: string,
  pathValue: string,
  agentName?: string,
): string {
  const subject = agentName ? `Agent '${agentName}'` : "Current agent";
  return `${subject} is not permitted to access path '${pathValue}' via tool '${toolName}'. Hard stop: this path permission denial is policy-enforced. Do not retry this path, do not attempt a filesystem bypass, and report the block to the user.`;
}

export function formatPathAskPrompt(
  toolName: string,
  pathValue: string,
  agentName?: string,
): string {
  const subject = agentName ? `Agent '${agentName}'` : "Current agent";
  return `${subject} requested tool '${toolName}' for path '${pathValue}'. Allow this path access?`;
}
