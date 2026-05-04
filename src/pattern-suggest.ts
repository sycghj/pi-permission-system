import { deriveApprovalPattern } from "./session-rules";

/** The suggestion returned for a "Yes, for this session" dialog option. */
export interface SessionApprovalSuggestion {
  /** The permission surface this approval applies to. */
  surface: string;
  /** The wildcard pattern to store as a session rule. */
  pattern: string;
  /** Human-readable label for the "for session" dialog option. */
  label: string;
}

/**
 * Suggest a bash session-approval pattern from a command string.
 *
 * Heuristic: split on the first space to get the base command.
 * Multi-word commands → `<command> *`.
 * Single-word commands → exact command (no wildcard).
 *
 * This is intentionally conservative. The arity table (#52) will refine
 * suggestions later (e.g. `git checkout *` instead of `git *`).
 */
export function suggestBashPattern(command: string): string {
  const trimmed = command.trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return trimmed;
  }
  return `${trimmed.slice(0, spaceIndex)} *`;
}

/**
 * Suggest an MCP session-approval pattern from a resolved target string.
 *
 * - Qualified target (`server:tool`) → `server:*`
 * - Munged target (`server_tool`) → `server_*`
 * - Bare target (no separator) → `*`
 */
export function suggestMcpPattern(target: string): string {
  const trimmed = target.trim();

  const colonIndex = trimmed.indexOf(":");
  if (colonIndex > 0) {
    return `${trimmed.slice(0, colonIndex)}:*`;
  }

  const underscoreIndex = trimmed.indexOf("_");
  if (underscoreIndex > 0) {
    return `${trimmed.slice(0, underscoreIndex)}_*`;
  }

  return "*";
}

function buildLabel(pattern: string): string {
  return `Yes, allow "${pattern}" for this session`;
}

/**
 * Suggest a session-approval pattern for the given permission surface and value.
 *
 * Returns a `SessionApprovalSuggestion` with the surface, the wildcard pattern
 * to store in `SessionRules`, and a human-readable dialog label.
 */
export function suggestSessionPattern(
  surface: string,
  value: string,
): SessionApprovalSuggestion {
  let pattern: string;

  switch (surface) {
    case "bash":
      pattern = suggestBashPattern(value);
      break;
    case "mcp":
      pattern = suggestMcpPattern(value);
      break;
    case "skill":
      pattern = value;
      break;
    case "external_directory":
      pattern = deriveApprovalPattern(value);
      break;
    default:
      // Tool surfaces (read, write, edit, grep, find, ls, extension tools)
      pattern = "*";
      break;
  }

  return { surface, pattern, label: buildLabel(pattern) };
}
