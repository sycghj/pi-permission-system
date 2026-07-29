import type { AccessPath } from "#src/access-intent/access-path";
import { PATH_BEARING_TOOLS } from "#src/access-intent/path-surfaces";
import { getPathBearingToolPath } from "#src/access-intent/tool-input-path";
import {
  classifyToolKind,
  type ShellInvocation,
} from "#src/access-intent/tool-kind";
import { suggestSessionPattern } from "#src/pattern-suggest";
import { formatAskPrompt } from "#src/permission-prompts";
import { SessionApproval } from "#src/session-approval";
import type { ToolPreviewFormatter } from "#src/tool-preview-formatter";
import type { PermissionCheckResult } from "#src/types";
import type { GateDescriptor } from "./descriptor";
import {
  accessFactsFromPath,
  accessFactsFromValue,
  deriveDecisionValue,
} from "./helpers";
import type { ToolCallContext } from "./types";

/**
 * Derive the value used for session-approval pattern suggestions.
 *
 * Bash → command string; MCP → qualified target;
 * path-bearing tools → the `AccessPath`'s lexical absolute form (`value()`),
 * so the suggested pattern matches the policy values a later call produces;
 * others (or a path-bearing tool with no path) → catch-all wildcard.
 */
function deriveSuggestionValue(
  toolName: string,
  check: PermissionCheckResult,
  accessPath?: AccessPath,
): string {
  switch (classifyToolKind(toolName)) {
    case "bash":
      return check.command ?? "";
    case "mcp":
      return check.target ?? "mcp";
    default:
      return accessPath ? accessPath.value() : "*";
  }
}

/**
 * Build a pure descriptor for the normal tool permission gate.
 *
 * Takes a pre-computed PermissionCheckResult (from checkPermission) and
 * returns a GateDescriptor that the runner can execute. No side effects.
 */
export function describeToolGate(
  tcc: ToolCallContext,
  check: PermissionCheckResult,
  formatter: ToolPreviewFormatter,
  accessPath?: AccessPath,
  shell?: ShellInvocation | null,
): GateDescriptor {
  // A shell invocation (native `bash` or an aliased shell tool) is gated on the
  // `bash` surface — its session rule, decision value, and suggestion are
  // bash-shaped — while the invoked tool name is preserved in the prompt and
  // review log so a user sees which tool actually ran (#574).
  const gateSurface = shell ? "bash" : tcc.toolName;

  const permissionLogContext = formatter.getPermissionLogContext(
    check,
    tcc.input,
    PATH_BEARING_TOOLS,
  );

  // Compute session approval suggestion for the "for this session" option.
  const suggestion = suggestSessionPattern(
    gateSurface,
    deriveSuggestionValue(gateSurface, check, accessPath),
  );

  const askMessage = formatAskPrompt(
    check,
    tcc.agentName ?? undefined,
    tcc.input,
    formatter,
  );

  const decisionValue = deriveDecisionValue(
    gateSurface,
    check,
    getPathBearingToolPath(tcc.toolName, tcc.input) ?? undefined,
  );

  // A path-bearing tool carries the AccessPath's alias set; every other surface
  // (bash command, MCP target, plain tool) carries its already-portable value.
  const accessIntent = accessPath
    ? accessFactsFromPath(gateSurface, accessPath)
    : accessFactsFromValue(gateSurface, decisionValue);

  return {
    surface: gateSurface,
    input: tcc.input,
    denialContext: {
      kind: "tool",
      check,
      agentName: tcc.agentName ?? undefined,
      input: tcc.input,
    },
    sessionApproval: SessionApproval.single(
      suggestion.surface,
      suggestion.pattern,
    ),
    promptDetails: {
      source: "tool_call",
      agentName: tcc.agentName,
      message: askMessage,
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      sessionLabel: suggestion.label,
      accessIntent,
      ...permissionLogContext,
    },
    logContext: {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      message: askMessage,
      ...permissionLogContext,
    },
    decision: {
      surface: gateSurface,
      value: decisionValue,
    },
    autoMode: autoModeRouting(check),
  };
}

const HUMAN_AUTHORITY_PATTERNS: Record<string, string> = {
  "<credential-network-egress>": "credential_network_egress_requires_human",
  "<destructive-git-history>": "destructive_git_history_requires_human",
  "<indirection-bash-wrapper>": "indirection_bash_wrapper_requires_human",
  "<opaque-bash-wrapper>": "opaque_bash_wrapper_requires_human",
  "<permission-config-write>": "permission_config_write_requires_human",
  "<unparseable-bash-command>": "unparseable_bash_requires_human",
};

function humanAuthorityRouting(reason: string): GateDescriptor["autoMode"] {
  return { classifierApprovable: false, reason };
}

function autoModeRouting(
  check: PermissionCheckResult,
): GateDescriptor["autoMode"] {
  if (check.state !== "ask") return undefined;
  if (check.commandContext) {
    return humanAuthorityRouting(`bash_${check.commandContext}_requires_human`);
  }
  if (!check.matchedPattern) return undefined;
  const reason = HUMAN_AUTHORITY_PATTERNS[check.matchedPattern];
  return reason ? humanAuthorityRouting(reason) : undefined;
}
