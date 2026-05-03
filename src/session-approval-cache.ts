import { dirname, sep } from "node:path";

import { isPathWithinDirectory } from "./external-directory";

/**
 * Ephemeral in-memory cache of session-scoped permission approvals.
 * Keyed by permission surface (e.g. "external_directory"), values are
 * normalized directory prefixes that have been approved for the session.
 *
 * Cleared on session_shutdown — never persisted to disk.
 */
export class SessionApprovalCache {
  private approvals = new Map<string, Set<string>>();

  /** Record a directory prefix as approved for the given surface. */
  approve(surface: string, prefix: string): void {
    let prefixes = this.approvals.get(surface);
    if (!prefixes) {
      prefixes = new Set();
      this.approvals.set(surface, prefixes);
    }
    prefixes.add(prefix);
  }

  /**
   * Check whether a path falls under any approved prefix for the given surface.
   * Uses `isPathWithinDirectory()` for correct separator-aware prefix matching.
   */
  has(surface: string, path: string): boolean {
    const prefixes = this.approvals.get(surface);
    if (!prefixes) {
      return false;
    }
    for (const prefix of prefixes) {
      if (isPathWithinDirectory(path, prefix)) {
        return true;
      }
    }
    return false;
  }

  /** Find and return the matching approved prefix, or null if none matches. */
  findMatchingPrefix(surface: string, path: string): string | null {
    const prefixes = this.approvals.get(surface);
    if (!prefixes) {
      return null;
    }
    for (const prefix of prefixes) {
      if (isPathWithinDirectory(path, prefix)) {
        return prefix;
      }
    }
    return null;
  }

  /** Remove all session approvals. */
  clear(): void {
    this.approvals.clear();
  }
}

/**
 * Derive the directory prefix to approve from a normalized path.
 * Returns `dirname(path)` with a trailing separator so that
 * prefix matching via `isPathWithinDirectory()` works correctly.
 *
 * For paths that already end with a separator (directories),
 * the trailing separator is stripped by dirname and re-added.
 */
export function deriveApprovalPrefix(normalizedPath: string): string {
  // If the path already ends with a separator, it's a directory — return as-is.
  if (normalizedPath.endsWith(sep)) {
    return normalizedPath;
  }
  const dir = dirname(normalizedPath);
  if (dir === normalizedPath) {
    // Root path — dirname('/') === '/'
    return dir;
  }
  return dir.endsWith(sep) ? dir : `${dir}${sep}`;
}
