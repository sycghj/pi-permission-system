import { homedir } from "node:os";

/**
 * Expand `~` and `$HOME` prefixes in a pattern to the OS home directory.
 *
 * Supported forms:
 * - `~`          → `homedir()`
 * - `~/path`     → `homedir()/path`
 * - `~\path`     → `homedir()\path` (Windows)
 * - `$HOME`      → `homedir()`
 * - `$HOME/path` → `homedir()/path`
 * - `$HOME\path` → `homedir()\path` (Windows)
 *
 * The original separator (`/` or `\`) is preserved through the join so the
 * expanded path matches the caller's `PathFlavor` rather than the ambient
 * platform path semantics — this keeps home-relative patterns deterministic
 * when a `posixPathFlavor`/`win32PathFlavor` is injected for cross-platform
 * matching. All other patterns are returned unchanged.
 */
export function expandHomePath(pattern: string): string {
  if (pattern === "~" || pattern === "$HOME") return homedir();
  if (pattern.startsWith("~/") || pattern.startsWith("~\\")) {
    return joinHome(pattern.slice(2), pattern[1]);
  }
  if (pattern.startsWith("$HOME/") || pattern.startsWith("$HOME\\")) {
    return joinHome(pattern.slice(6), pattern[5]);
  }
  return pattern;
}

function joinHome(rest: string, separator: string | undefined): string {
  const home = homedir();
  const sep = separator === "/" || separator === "\\" ? separator : "/";
  return `${home}${sep}${rest.replaceAll(/[\\/]/g, sep)}`;
}
