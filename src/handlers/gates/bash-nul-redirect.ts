import type { BashProgram } from "#src/access-intent/bash/program";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import type { GateResult } from "./descriptor";
import type { ToolCallContext } from "./types";

/**
 * The synthetic pattern recorded for a Win32 reserved-name redirect denial,
 * matched by no user rule and eligible for no session approval — the only
 * correct spelling is `/dev/null`.
 */
const NUL_REDIRECT_SENTINEL = "<win32-nul-redirect>";

/**
 * Build a pure descriptor for the Win32 NUL-redirect permission gate.
 *
 * On a win32 host Pi executes bash through Git Bash (MSYS2), where `nul` is
 * **not** a device: `cmd 2>nul` creates a real file named `nul` in the working
 * directory. That file is un-indexable by git and un-deletable by ordinary
 * Win32 tools (the name routes to the NUL device outside `\\?\` paths). LLM
 * agents habitually emit the CMD spelling from training data, so this is a
 * recurring accident, not an intent — and the deny message must say so and
 * teach the fix (`/dev/null`) instead of leaving the agent to retry.
 *
 * Scope — only local `file_redirect` destinations are inspected:
 * - `cmd.exe /c "… 2>NUL"` and `ssh host "… 2>nul"` payloads are quoted string
 *   arguments the local shell never interprets, so they stay allowed (the CMD
 *   spelling is *correct* there);
 * - on POSIX hosts `nul` is an ordinary legal filename, so the gate is inert.
 *
 * Deterministic `deny` with no session-approval offer and no auto-mode: there
 * is no legitimate reason to write to the reserved name on win32, so no
 * classifier should be allowed to approve it and no session rule should be
 * able to widen it. Mirrors the fail-closed sentinels (`#452`, `#481`) in
 * spirit — a deterministic safety floor, not a policy question.
 */
export function describeBashNulRedirectGate(
  tcc: ToolCallContext,
  bashProgram: BashProgram | null,
  _resolver: ScopedPermissionResolver,
): GateResult {
  if (!bashProgram) return null;
  const command = bashProgram.commandText();

  const nulTargets = bashProgram.nulRedirectTargets();
  if (nulTargets.length === 0) return null;

  const tokens = [...new Set(nulTargets.map((hit) => hit.token))];

  const message =
    `Bash command redirects to the Windows reserved name '${tokens.join("', '")}' ` +
    "(Git Bash does not map 'nul' to a device — this creates an un-indexable, " +
    "un-deletable file in the working directory). " +
    "Rewrite the redirect as /dev/null (Git Bash's actual null device) and retry.";

  return {
    surface: "bash",
    input: { command },
    denialContext: {
      kind: "bash_nul_redirect",
      command,
      targets: nulTargets,
      agentName: tcc.agentName ?? undefined,
    },
    promptDetails: {
      source: "tool_call",
      agentName: tcc.agentName,
      message,
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      command,
    },
    logContext: {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      agentName: tcc.agentName,
      command,
      nulRedirectTargets: nulTargets,
      message,
    },
    decision: {
      surface: "bash",
      value: command,
    },
    preCheck: {
      state: "deny",
      toolName: "bash",
      source: "special",
      origin: "builtin",
      command,
      matchedPattern: NUL_REDIRECT_SENTINEL,
      reason:
        "redirects to the Windows reserved device name 'nul'; use /dev/null instead",
    },
  };
}
