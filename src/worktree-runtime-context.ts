import { execFileSync } from "node:child_process";
import type {
  AutoModePathAlias,
  AutoModeWorkspaceContext,
} from "./auto-mode-runtime-summary";

export interface WorktreeRuntimeInfo {
  workspace: AutoModeWorkspaceContext;
  pathAliases: readonly AutoModePathAlias[];
}

export type RunGit = (cwd: string, args: readonly string[]) => string;

export function detectWorktreeRuntime(
  options: {
    cwd?: string;
    agentName?: string | null;
    input?: unknown;
  },
  runGit: RunGit = defaultRunGit,
): WorktreeRuntimeInfo | undefined {
  for (const candidate of worktreeCandidatePaths(options.cwd, options.input)) {
    const info = detectCandidate(candidate, options.agentName, runGit);
    if (info) return info;
  }
  return undefined;
}

export function isSameRepositoryWorktreePath(
  cwd: string,
  pathValue: string,
  runGit: RunGit = defaultRunGit,
): boolean {
  const baseCommonDir = gitCommonDir(cwd, runGit);
  const candidateCommonDir = gitCommonDirForPath(pathValue, runGit);
  return Boolean(
    baseCommonDir &&
      candidateCommonDir &&
      samePath(baseCommonDir, candidateCommonDir) &&
      !containsPath(cwd, pathValue),
  );
}

export function isGitWorktreeAddTarget(
  cwd: string,
  pathValue: string,
  command: string | undefined,
  runGit: RunGit = defaultRunGit,
): boolean {
  if (!command || !gitRepoRoot(cwd, runGit)) return false;
  const target = gitWorktreeAddTarget(command);
  return Boolean(target && samePath(toHostPath(target), pathValue));
}

export function worktreeCandidatePaths(
  cwd?: string,
  input?: unknown,
): string[] {
  const paths = new Set<string>();
  if (cwd) paths.add(toHostPath(cwd));
  const command = commandFromInput(input);
  const cdTarget = command ? firstLiteralCdTarget(command) : undefined;
  if (cdTarget) paths.add(toHostPath(cdTarget));
  return [...paths].filter(Boolean);
}

function detectCandidate(
  candidate: string,
  agentName: string | null | undefined,
  runGit: RunGit,
): WorktreeRuntimeInfo | undefined {
  const worktreeCwd = normalizePath(
    runGit(candidate, ["rev-parse", "--show-toplevel"]),
  );
  if (!worktreeCwd) return undefined;

  const parentCwd = parentWorktreeRoot(
    worktreeCwd,
    runGit(candidate, ["worktree", "list", "--porcelain"]),
  );
  if (!parentCwd) return undefined;

  const projectRelative = relativePath(worktreeCwd, normalizePath(candidate));
  return {
    workspace: {
      kind: "git-worktree",
      agentName: agentName ?? undefined,
      worktreeCwd,
      parentCwd,
    },
    pathAliases: [
      {
        lexical: candidate,
        worktreeAbsolute: normalizePath(candidate),
        projectRelative,
        parentEquivalent: joinPath(parentCwd, projectRelative),
      },
    ],
  };
}

function defaultRunGit(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    });
  } catch {
    return "";
  }
}

function parentWorktreeRoot(
  worktreeCwd: string,
  porcelain: string,
): string | undefined {
  const roots = porcelain
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => normalizePath(line.slice("worktree ".length)))
    .filter(Boolean);
  return roots.find((root) => !samePath(root, worktreeCwd));
}

function gitCommonDir(cwd: string, runGit: RunGit): string {
  return normalizePath(
    runGit(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  );
}

function gitCommonDirForPath(pathValue: string, runGit: RunGit): string {
  for (const candidate of pathAndParents(pathValue)) {
    const commonDir = gitCommonDir(candidate, runGit);
    if (commonDir) return commonDir;
  }
  return "";
}

function pathAndParents(pathValue: string): string[] {
  const paths: string[] = [];
  let current = normalizePath(toHostPath(pathValue));
  while (current) {
    paths.push(current);
    const parent = parentPath(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return paths;
}

function parentPath(pathValue: string): string {
  const normalized = normalizePath(pathValue);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) return "";
  if (/^[A-Za-z]:$/.test(normalized.slice(0, slash))) {
    return `${normalized.slice(0, slash)}/`;
  }
  return normalized.slice(0, slash);
}

function gitRepoRoot(cwd: string, runGit: RunGit): string {
  return normalizePath(runGit(cwd, ["rev-parse", "--show-toplevel"]));
}

function gitWorktreeAddTarget(command: string): string | undefined {
  const tokens = tokenizeCommand(command);
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (tokens[index] !== "git") continue;
    if (tokens[index + 1] !== "worktree" || tokens[index + 2] !== "add") {
      continue;
    }
    return firstWorktreeAddPath(tokens.slice(index + 3));
  }
  return undefined;
}

function firstWorktreeAddPath(tokens: readonly string[]): string | undefined {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token === "&&" || token === ";" || token === "|") {
      return undefined;
    }
    if (token.startsWith("-")) {
      if (optionRequiresValue(token)) index += 1;
      continue;
    }
    return token;
  }
  return undefined;
}

function optionRequiresValue(token: string): boolean {
  return token === "-b" || token === "-B" || token === "--reason";
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  const pattern = /&&|[;|]|"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s;|&]+)/g;
  let match = pattern.exec(command);
  while (match !== null) {
    tokens.push(match.at(1) ?? match.at(2) ?? match.at(3) ?? match[0]);
    match = pattern.exec(command);
  }
  return tokens;
}

function containsPath(root: string, pathValue: string): boolean {
  const normalizedRoot = normalizePath(root).toLowerCase();
  const normalizedPath = normalizePath(pathValue).toLowerCase();
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  );
}

function commandFromInput(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as { command?: unknown }).command;
  return typeof value === "string" ? value : undefined;
}

function firstLiteralCdTarget(command: string): string | undefined {
  const match =
    /(?:^|&&|;|\n)\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^&;|\n\s]+))/.exec(command);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function toHostPath(pathValue: string): string {
  return pathValue.replace(
    /^\/([a-zA-Z])\//,
    (_, drive: string) => `${drive.toUpperCase()}:/`,
  );
}

function normalizePath(pathValue: string): string {
  return pathValue.trim().replaceAll("\\", "/").replace(/\/+$/g, "");
}

function samePath(a: string, b: string): boolean {
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
}

function relativePath(root: string, pathValue: string): string {
  const normalizedRoot = normalizePath(root);
  const normalizedPath = normalizePath(pathValue);
  if (samePath(normalizedRoot, normalizedPath)) return ".";
  const prefix = `${normalizedRoot}/`.toLowerCase();
  if (normalizedPath.toLowerCase().startsWith(prefix)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return ".";
}

function joinPath(root: string, relative: string): string {
  if (relative === ".") return root;
  return `${root.replace(/\/+$/g, "")}/${relative.replace(/^\/+/, "")}`;
}
