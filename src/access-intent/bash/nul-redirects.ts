import {
  ARG_NODE_TYPES,
  resolveNodeText,
  SKIP_SUBTREE_TYPES,
} from "#src/access-intent/bash/node-text";
import type { TSNode } from "#src/access-intent/bash/parser";
import type { PathFlavor } from "#src/path/path-flavor";

// ── Public types ────────────────────────────────────────────────────────────

/**
 * A local bash file redirect whose destination is the Win32 reserved device
 * name `nul` (any case, with or without an extension).
 *
 * On a win32 host Pi executes bash through Git Bash (MSYS2), where `nul` is
 * **not** a device: `cmd 2>nul` creates a real file named `nul` in the working
 * directory. That file is then un-indexable by git (`short read while indexing
 * nul`) and un-deletable by ordinary Win32 tools, because the name resolves to
 * the NUL device outside `\\?\` paths. The correct POSIX spelling — the one
 * that actually discards output in Git Bash — is `/dev/null`.
 */
export interface NulRedirectTarget {
  /** The raw destination token as written (e.g. `nul`, `NUL.txt`). */
  readonly token: string;
  /** `write` for `>`/`>>`/`&>`/`&>>`, `read` for `<`. */
  readonly mode: "write" | "read";
}

// ── Reserved-name shape ─────────────────────────────────────────────────────

/**
 * The reserved basename `nul`, case-insensitive, with an optional extension
 * (`nul.txt` also resolves to the NUL device in Win32). Anchored per component:
 * `null`, `manual.txt`, and `nularity` do not match; a directory-qualified
 * target is judged by its final component (`sub/nul.txt` matches).
 */
const NUL_BASENAME_PATTERN = /^nul(?:\.[^./\\]*)?$/i;

/** True when a redirect destination token names the Win32 `nul` device. */
export function isNulRedirectToken(token: string): boolean {
  const lastSegment = token.split(/[\\/]/).pop() ?? token;
  return NUL_BASENAME_PATTERN.test(lastSegment);
}

// ── Extraction ──────────────────────────────────────────────────────────────

/**
 * Walk a parsed bash program once and collect every local file redirect whose
 * destination names the Win32 reserved device `nul`.
 *
 * Scope mirrors the token collector's semantics:
 * - only local `file_redirect` nodes count — a redirect spelling inside a
 *   quoted payload (`cmd.exe /c "… 2>NUL"`, `ssh host "… 2>nul"`) is a string
 *   argument the local shell never interprets, so it is correctly invisible;
 * - `heredoc_body`, `heredoc_end`, and `comment` subtrees are skipped;
 * - destinations are read with quote removal, so `> 'nul'` is caught.
 *
 * Returns `[]` on a POSIX-flavored host, where `nul` is an ordinary legal
 * filename and redirecting to it is neither an accident nor un-deletable.
 *
 * Pure and synchronous: no filesystem, no platform read — the win32-vs-POSIX
 * decision arrives via the injected {@link PathFlavor}.
 */
export function extractNulRedirects(
  rootNode: TSNode,
  flavor: PathFlavor,
): NulRedirectTarget[] {
  if (flavor.impl.sep !== "\\") return [];
  const out: NulRedirectTarget[] = [];
  walk(rootNode, out);
  return out;
}

// ── Private walker ──────────────────────────────────────────────────────────

/** Read mode operators; every other redirect operator writes the target. */
const READ_OPERATORS = new Set(["<"]);

function walk(node: TSNode, out: NulRedirectTarget[]): void {
  if (SKIP_SUBTREE_TYPES.has(node.type)) return;

  if (node.type === "file_redirect") {
    const hit = inspectRedirect(node);
    if (hit) out.push(hit);
    // A file_redirect has no nested commands; nothing further to descend.
    return;
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.isNamed) walk(child, out);
  }
}

/**
 * Inspect one `file_redirect` node: resolve its destination with quote
 * removal, test the reserved-name shape, and classify write-vs-read from the
 * operator's anonymous literal child (`>`, `>>`, `&>`, `&>>`, `<`).
 */
function inspectRedirect(node: TSNode): NulRedirectTarget | null {
  let operator: string | null = null;
  let destination: string | null = null;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (!child.isNamed) {
      // The operator is the anonymous literal child; its node type is the
      // operator's own spelling (tree-sitter-bash grammar).
      operator ??= child.type;
      continue;
    }
    if (child.type === "file_descriptor") continue;
    if (ARG_NODE_TYPES.has(child.type)) {
      destination = resolveNodeText(child);
      break;
    }
  }

  if (destination === null || !isNulRedirectToken(destination)) return null;
  return {
    token: destination,
    mode: operator !== null && READ_OPERATORS.has(operator) ? "read" : "write",
  };
}
