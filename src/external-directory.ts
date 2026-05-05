import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, normalize, resolve, sep } from "node:path";

import { getNonEmptyString, toRecord } from "./common";

/**
 * Paths that are universally safe and should never trigger external-directory checks.
 * These are OS device files: read returns EOF or process streams, write discards or goes to process streams.
 */
export const SAFE_SYSTEM_PATHS: ReadonlySet<string> = new Set([
  "/dev/null",
  "/dev/stdin",
  "/dev/stdout",
  "/dev/stderr",
]);

/**
 * Returns true if the given normalized path is a safe OS device file
 * that should never trigger external-directory checks.
 */
export function isSafeSystemPath(normalizedPath: string): boolean {
  return SAFE_SYSTEM_PATHS.has(normalizedPath);
}

export const PATH_BEARING_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "find",
  "grep",
  "ls",
]);

export function normalizePathForComparison(
  pathValue: string,
  cwd: string,
): string {
  const trimmed = pathValue.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) {
    return "";
  }

  let normalizedPath = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;

  if (normalizedPath === "~") {
    normalizedPath = homedir();
  } else if (
    normalizedPath.startsWith("~/") ||
    normalizedPath.startsWith("~\\")
  ) {
    normalizedPath = join(homedir(), normalizedPath.slice(2));
  }

  const absolutePath = resolve(cwd, normalizedPath);
  const normalizedAbsolutePath = normalize(absolutePath);
  return process.platform === "win32"
    ? normalizedAbsolutePath.toLowerCase()
    : normalizedAbsolutePath;
}

export function isPathWithinDirectory(
  pathValue: string,
  directory: string,
): boolean {
  if (!pathValue || !directory) {
    return false;
  }

  if (pathValue === directory) {
    return true;
  }

  const prefix = directory.endsWith(sep) ? directory : `${directory}${sep}`;
  return pathValue.startsWith(prefix);
}

export function getPathBearingToolPath(
  toolName: string,
  input: unknown,
): string | null {
  if (!PATH_BEARING_TOOLS.has(toolName)) {
    return null;
  }

  return getNonEmptyString(toRecord(input).path);
}

export function isPathOutsideWorkingDirectory(
  pathValue: string,
  cwd: string,
): boolean {
  const normalizedCwd = normalizePathForComparison(cwd, cwd);
  const normalizedPath = normalizePathForComparison(pathValue, cwd);
  if (!normalizedCwd || !normalizedPath) {
    return false;
  }
  if (isSafeSystemPath(normalizedPath)) {
    return false;
  }
  return !isPathWithinDirectory(normalizedPath, normalizedCwd);
}

export function formatExternalDirectoryHardStopHint(): string {
  return "Hard stop: this external directory permission denial is policy-enforced. Do not retry this path, do not attempt a filesystem bypass, and report the block to the user.";
}

export function formatExternalDirectoryAskPrompt(
  toolName: string,
  pathValue: string,
  cwd: string,
  agentName?: string,
): string {
  const subject = agentName ? `Agent '${agentName}'` : "Current agent";
  return `${subject} requested tool '${toolName}' for path '${pathValue}' outside working directory '${cwd}'. Allow this external directory access?`;
}

export function formatExternalDirectoryDenyReason(
  toolName: string,
  pathValue: string,
  cwd: string,
  agentName?: string,
): string {
  const subject = agentName ? `Agent '${agentName}'` : "Current agent";
  return `${subject} is not permitted to run tool '${toolName}' for path '${pathValue}' outside working directory '${cwd}'. ${formatExternalDirectoryHardStopHint()}`;
}

export function formatExternalDirectoryUserDeniedReason(
  toolName: string,
  pathValue: string,
  denialReason?: string,
): string {
  const reasonSuffix = denialReason ? ` Reason: ${denialReason}.` : "";
  return `User denied external directory access for tool '${toolName}' path '${pathValue}'.${reasonSuffix} ${formatExternalDirectoryHardStopHint()}`;
}

export function formatBashExternalDirectoryAskPrompt(
  command: string,
  externalPaths: string[],
  cwd: string,
  agentName?: string,
): string {
  const subject = agentName ? `Agent '${agentName}'` : "Current agent";
  const pathList = externalPaths.join(", ");
  return `${subject} requested bash command '${command}' which references path(s) outside working directory '${cwd}': ${pathList}. Allow this external directory access?`;
}

export function formatBashExternalDirectoryDenyReason(
  command: string,
  externalPaths: string[],
  cwd: string,
  agentName?: string,
): string {
  const subject = agentName ? `Agent '${agentName}'` : "Current agent";
  const pathList = externalPaths.join(", ");
  return `${subject} is not permitted to run bash command '${command}' which references path(s) outside working directory '${cwd}': ${pathList}. ${formatExternalDirectoryHardStopHint()}`;
}

// ── tree-sitter-bash lazy parser ───────────────────────────────────────────

/**
 * Minimal subset of web-tree-sitter's SyntaxNode used by the AST walker.
 * Defined locally so callers do not need to import web-tree-sitter types.
 */
interface TSNode {
  readonly type: string;
  readonly text: string;
  readonly childCount: number;
  child(index: number): TSNode | null;
}

/**
 * Minimal subset of web-tree-sitter's Parser used by this module.
 */
interface TSParser {
  parse(input: string): { rootNode: TSNode; delete(): void } | null;
  delete(): void;
}

let parserPromise: Promise<TSParser> | null = null;

async function initParser(): Promise<TSParser> {
  // Use named imports — web-tree-sitter exports Parser as a named class.
  const { Parser, Language } = await import("web-tree-sitter");
  const req = createRequire(import.meta.url);
  const treeSitterWasm = req.resolve("web-tree-sitter/web-tree-sitter.wasm");
  await Parser.init({ locateFile: () => treeSitterWasm });

  const parser = new Parser();
  const bashWasm = req.resolve("tree-sitter-bash/tree-sitter-bash.wasm");
  const bash = await Language.load(bashWasm);
  parser.setLanguage(bash);
  return parser as TSParser;
}

function getParser(): Promise<TSParser> {
  if (!parserPromise) {
    parserPromise = initParser();
  }
  return parserPromise;
}

/**
 * Reset the cached parser promise.  Only used by tests to avoid
 * cross-test pollution or to inject a mock parser.
 */
export function resetParserForTesting(): void {
  parserPromise = null;
}

// ── AST walker ─────────────────────────────────────────────────────────────

/**
 * Node types whose subtrees must never be descended into for
 * path extraction — their text content is not a command argument.
 */
const SKIP_SUBTREE_TYPES = new Set(["heredoc_body", "heredoc_end", "comment"]);

/**
 * Resolve the "shell value" of an argument node — the string the shell
 * would pass to the command after quote removal.
 *
 * - `word`          → `.text` (already unquoted)
 * - `raw_string`    → strip surrounding single quotes
 * - `string`        → strip surrounding double quotes, concatenate children text
 * - `concatenation` → concatenate resolved children
 * - other           → `.text` as fallback
 */
function resolveNodeText(node: TSNode): string {
  switch (node.type) {
    case "word":
      return node.text;
    case "raw_string": {
      // Strip surrounding single quotes: 'content' → content
      const t = node.text;
      if (t.length >= 2 && t[0] === "'" && t[t.length - 1] === "'") {
        return t.slice(1, -1);
      }
      return t;
    }
    case "string": {
      // Double-quoted string: concatenate the resolved text of inner children,
      // skipping the quote-delimiter nodes (literal `"`).
      let result = "";
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;
        // Skip the literal `"` delimiters
        if (child.type === '"') continue;
        result += resolveNodeText(child);
      }
      return result;
    }
    case "string_content":
    case "simple_expansion":
    case "expansion":
      return node.text;
    case "concatenation": {
      let result = "";
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;
        result += resolveNodeText(child);
      }
      return result;
    }
    default:
      return node.text;
  }
}

/**
 * Recursively visit the AST and collect resolved text of nodes that
 * represent command arguments or redirect destinations.
 *
 * Skips `heredoc_body`, `heredoc_end`, and `comment` subtrees entirely.
 */
function collectPathCandidateTokens(node: TSNode, tokens: string[]): void {
  if (SKIP_SUBTREE_TYPES.has(node.type)) return;

  // Extract arguments from `command` nodes (skip the command name).
  if (node.type === "command") {
    let seenCommandName = false;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;

      if (child.type === "command_name") {
        seenCommandName = true;
        continue;
      }
      // Skip variable_assignment nodes (FOO=/bar)
      if (child.type === "variable_assignment") continue;

      // If there was no explicit command_name node, the first word-like
      // child is the command name itself — skip it.
      if (
        !seenCommandName &&
        (child.type === "word" ||
          child.type === "concatenation" ||
          child.type === "string" ||
          child.type === "raw_string")
      ) {
        seenCommandName = true;
        continue;
      }

      // Argument nodes: resolve their text and collect.
      if (
        child.type === "word" ||
        child.type === "concatenation" ||
        child.type === "string" ||
        child.type === "raw_string"
      ) {
        tokens.push(resolveNodeText(child));
        continue;
      }

      // Recurse into other children (e.g. command_substitution nested in args)
      collectPathCandidateTokens(child, tokens);
    }
    return;
  }

  // Extract redirect destinations from `file_redirect` nodes.
  if (node.type === "file_redirect") {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      if (
        child.type === "word" ||
        child.type === "concatenation" ||
        child.type === "string" ||
        child.type === "raw_string"
      ) {
        tokens.push(resolveNodeText(child));
      }
    }
    return;
  }

  // For all other node types, recurse into children.
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    collectPathCandidateTokens(child, tokens);
  }
}

/**
 * URL pattern to skip tokens that look like URLs rather than paths.
 */
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Regex metacharacter sequences that are never found in real filesystem paths.
 * If a token contains any of these, it is almost certainly a regex pattern
 * (e.g. a grep argument) rather than a path.
 */
const REGEX_METACHAR_PATTERN = /\.\*|\.\+|\\\||\\\(|\\\)|\[.*?\]|\^\//;

/**
 * Determines whether a token looks like a path candidate worth resolving.
 * Returns the raw token string if it's a candidate, or null to skip.
 */
function classifyTokenAsPathCandidate(token: string): string | null {
  // Skip empty tokens
  if (!token) return null;

  // Skip flags
  if (token.startsWith("-")) return null;

  // Skip env assignments (FOO=/bar)
  const eqIndex = token.indexOf("=");
  const slashIndex = token.indexOf("/");
  if (eqIndex !== -1 && (slashIndex === -1 || eqIndex < slashIndex)) {
    return null;
  }

  // Skip URLs
  if (URL_PATTERN.test(token)) return null;

  // Skip @scope/package patterns
  if (token.startsWith("@") && !token.startsWith("@/")) return null;

  // Skip bare-slash tokens (// JS comments, lone /, etc.) — they resolve to root
  // and are never meaningful path arguments in practice.
  if (/^\/+$/.test(token)) return null;

  // Skip tokens that contain regex metacharacter sequences — these are almost
  // certainly grep/sed/awk patterns, not filesystem paths.
  // Matches: .*, .+, \|, \(, \), [...], or ^/ (anchored regex starting with /)
  if (REGEX_METACHAR_PATTERN.test(token)) return null;

  // Must look like a path: starts with /, ~/, or contains ..
  if (token.startsWith("/")) return token;
  if (token.startsWith("~/")) return token;
  if (token.includes("..")) return token;

  return null;
}

/**
 * Extracts paths from a bash command string that resolve outside CWD.
 * Uses tree-sitter-bash to parse the command into a full AST, then walks
 * command argument and redirect-destination nodes.  Heredoc bodies, comments,
 * and other non-argument content are skipped, eliminating false positives.
 */
export async function extractExternalPathsFromBashCommand(
  command: string,
  cwd: string,
): Promise<string[]> {
  const parser = await getParser();
  const tree = parser.parse(command);
  if (!tree) return [];

  const tokens: string[] = [];
  try {
    collectPathCandidateTokens(tree.rootNode, tokens);
  } finally {
    tree.delete();
  }

  const seen = new Set<string>();
  const externalPaths: string[] = [];

  for (const token of tokens) {
    const candidate = classifyTokenAsPathCandidate(token);
    if (!candidate) continue;

    const normalized = normalizePathForComparison(candidate, cwd);
    if (!normalized) continue;

    if (
      isPathOutsideWorkingDirectory(candidate, cwd) &&
      !seen.has(normalized)
    ) {
      seen.add(normalized);
      externalPaths.push(normalized);
    }
  }

  return externalPaths;
}
