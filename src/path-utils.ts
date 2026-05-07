import { homedir } from "node:os";
import { join, normalize, resolve, sep } from "node:path";

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
