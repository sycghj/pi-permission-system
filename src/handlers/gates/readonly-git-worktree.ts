import { tokenizeCommand } from "#src/learning/bash-command-shape";
import {
  isSameRepositoryWorktreePath,
  type RunGit,
} from "#src/worktree-runtime-context";

const READONLY_GIT_COMMANDS = new Set([
  "diff",
  "log",
  "ls-files",
  "rev-parse",
  "show",
  "status",
]);

const SAFE_PIPE_COMMANDS = new Set(["findstr", "head", "rg", "sort", "wc"]);

/**
 * True when a bash command only inspects Git state in a sibling worktree that
 * shares the current repository identity. This covers the high-volume subagent
 * review shape without teaching the classifier to rediscover Git facts.
 */
export function isSameRepoReadonlyGitCommand(
  command: string,
  cwd: string,
  runGit?: RunGit,
): boolean {
  if (hasUnsafeShellShape(command)) return false;

  let workdir = cwd;
  let sawGit = false;
  for (const segment of command.split(/&&/)) {
    const trimmed = segment.trim();
    if (!trimmed) return false;
    const [primary, ...pipes] = trimmed.split("|").map((part) => part.trim());
    if (pipes.some((pipe) => !isSafePipe(pipe))) return false;

    const tokens = tokenizeCommand(primary);
    if (tokens.length === 0) return false;
    if (tokens[0] === "cd") {
      if (tokens.length !== 2) return false;
      const target = tokens[1];
      if (!isSameRepositoryWorktreePath(cwd, target, runGit)) return false;
      workdir = target;
      continue;
    }

    const git = parseGitInvocation(tokens, workdir);
    if (!git) return false;
    if (!isSameRepoGitWorkdir(cwd, git.workdir, runGit)) return false;
    if (!isReadonlyGitSubcommand(git.args)) return false;
    sawGit = true;
  }
  return sawGit;
}

function hasUnsafeShellShape(command: string): boolean {
  const withoutAnd = command.replace(/&&/g, "");
  return (
    /[;`$<>]/.test(command) ||
    withoutAnd.includes("&") ||
    command.includes("||")
  );
}

function isSafePipe(pipe: string): boolean {
  const tokens = tokenizeCommand(pipe);
  return tokens.length > 0 && SAFE_PIPE_COMMANDS.has(tokens[0]);
}

function parseGitInvocation(
  tokens: readonly string[],
  inheritedWorkdir: string,
): { workdir: string; args: readonly string[] } | undefined {
  if (tokens[0] !== "git") return undefined;
  if (tokens[1] === "-C") {
    if (!tokens[2]) return undefined;
    return { workdir: tokens[2], args: tokens.slice(3) };
  }
  return { workdir: inheritedWorkdir, args: tokens.slice(1) };
}

function isSameRepoGitWorkdir(
  cwd: string,
  workdir: string,
  runGit?: RunGit,
): boolean {
  return workdir === cwd || isSameRepositoryWorktreePath(cwd, workdir, runGit);
}

function isReadonlyGitSubcommand(args: readonly string[]): boolean {
  const subcommand = args[0];
  if (!subcommand || !READONLY_GIT_COMMANDS.has(subcommand)) return false;
  if (subcommand === "diff" && hasUnsafeDiffOption(args)) return false;
  return !args.includes("-c");
}

function hasUnsafeDiffOption(args: readonly string[]): boolean {
  return args.some(
    (arg) =>
      arg === "--ext-diff" ||
      arg === "--no-index" ||
      arg === "-c" ||
      arg.startsWith("--output"),
  );
}
