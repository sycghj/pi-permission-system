import { describe, expect, it } from "vitest";
import { isSameRepoReadonlyGitCommand } from "#src/handlers/gates/readonly-git-worktree";
import type { RunGit } from "#src/worktree-runtime-context";

const cwd = "D:/code/VisionNext";
const worktree = "D:/code/wt/VisionNext-dinov3-m22-wpf-integration";

function runGit(commonDir: string): RunGit {
  return (gitCwd, args) => {
    if (
      args.join(" ") !== "rev-parse --path-format=absolute --git-common-dir"
    ) {
      return "";
    }
    const normalized = gitCwd.replace(/\\/g, "/").toLowerCase();
    if (
      normalized === cwd.toLowerCase() ||
      normalized.startsWith(worktree.toLowerCase())
    ) {
      return commonDir;
    }
    return "D:/other/.git";
  };
}

describe("isSameRepoReadonlyGitCommand", () => {
  it("allows cd into a same-repository worktree followed by readonly git inspection", () => {
    expect(
      isSameRepoReadonlyGitCommand(
        `cd "${worktree}" && git diff --numstat && git ls-files --others --exclude-standard | wc -l`,
        cwd,
        runGit("D:/code/VisionNext/.git"),
      ),
    ).toBe(true);
  });

  it("allows git -C same-repository worktree readonly inspection", () => {
    expect(
      isSameRepoReadonlyGitCommand(
        `git -C "${worktree}" status --short`,
        cwd,
        runGit("D:/code/VisionNext/.git"),
      ),
    ).toBe(true);
  });

  it("rejects mutating git commands and unsafe diff options", () => {
    const git = runGit("D:/code/VisionNext/.git");
    expect(
      isSameRepoReadonlyGitCommand(
        `git -C "${worktree}" checkout main`,
        cwd,
        git,
      ),
    ).toBe(false);
    expect(
      isSameRepoReadonlyGitCommand(
        `git -C "${worktree}" diff --ext-diff`,
        cwd,
        git,
      ),
    ).toBe(false);
  });

  it("rejects readonly git commands in unrelated repositories", () => {
    expect(
      isSameRepoReadonlyGitCommand(
        `git -C "D:/other/project" status --short`,
        cwd,
        runGit("D:/code/VisionNext/.git"),
      ),
    ).toBe(false);
  });
});
