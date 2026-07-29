import { describe, expect, it } from "vitest";

import {
  detectWorktreeRuntime,
  isGitWorktreeAddTarget,
  isSameRepositoryWorktreePath,
  worktreeCandidatePaths,
} from "#src/worktree-runtime-context";

describe("worktree runtime context", () => {
  it("extracts a git-bash cd target as a host path candidate", () => {
    expect(
      worktreeCandidatePaths("C:/Temp/pi-agent-child", {
        command:
          'cd /d/code/wt/VisionNext-flowedit-m11 && rg -n "SelectedNode" VisionNext.App.Wpf',
      }),
    ).toEqual(["C:/Temp/pi-agent-child", "D:/code/wt/VisionNext-flowedit-m11"]);
  });

  it("maps a child worktree back to the parent project root", () => {
    const result = detectWorktreeRuntime(
      {
        cwd: "C:/Temp/pi-agent-child",
        agentName: "trellis-implement",
        input: {
          command:
            'cd /d/code/wt/VisionNext-flowedit-m11 && rg -n "SelectedNode" VisionNext.App.Wpf',
        },
      },
      (cwd, args) => {
        if (cwd === "C:/Temp/pi-agent-child") return "";
        if (args.join(" ") === "rev-parse --show-toplevel") {
          return "D:/code/wt/VisionNext-flowedit-m11\n";
        }
        if (args.join(" ") === "worktree list --porcelain") {
          return [
            "worktree D:/code/VisionNext",
            "HEAD abc123",
            "branch refs/heads/main",
            "",
            "worktree D:/code/wt/VisionNext-flowedit-m11",
            "HEAD abc123",
            "detached",
            "",
          ].join("\n");
        }
        return "";
      },
    );

    expect(result).toEqual({
      workspace: {
        kind: "git-worktree",
        agentName: "trellis-implement",
        worktreeCwd: "D:/code/wt/VisionNext-flowedit-m11",
        parentCwd: "D:/code/VisionNext",
      },
      pathAliases: [
        {
          lexical: "D:/code/wt/VisionNext-flowedit-m11",
          worktreeAbsolute: "D:/code/wt/VisionNext-flowedit-m11",
          projectRelative: ".",
          parentEquivalent: "D:/code/VisionNext",
        },
      ],
    });
  });

  it("recognizes sibling worktrees from the same git common directory", () => {
    expect(
      isSameRepositoryWorktreePath(
        "D:/code/VisionNext",
        "D:/code/wt/VisionNext-flowedit-m11",
        (cwd, args) => {
          if (
            args.join(" ") !==
            "rev-parse --path-format=absolute --git-common-dir"
          ) {
            return "";
          }
          if (
            cwd === "D:/code/VisionNext" ||
            cwd === "D:/code/wt/VisionNext-flowedit-m11"
          ) {
            return "D:/code/VisionNext/.git\n";
          }
          return "";
        },
      ),
    ).toBe(true);
  });

  it("recognizes file paths inside sibling worktrees from the same git common directory", () => {
    expect(
      isSameRepositoryWorktreePath(
        "D:/code/VisionNext",
        "D:/code/wt/VisionNext-flowedit-m12/VisionNext.App.Wpf/VisionNext.App.Wpf.csproj",
        (cwd, args) => {
          if (
            args.join(" ") !==
            "rev-parse --path-format=absolute --git-common-dir"
          ) {
            return "";
          }
          if (cwd === "D:/code/VisionNext") {
            return "D:/code/VisionNext/.git\n";
          }
          if (cwd === "D:/code/wt/VisionNext-flowedit-m12/VisionNext.App.Wpf") {
            return "D:/code/VisionNext/.git\n";
          }
          return "";
        },
      ),
    ).toBe(true);
  });

  it("recognizes a git worktree add target before the directory exists", () => {
    expect(
      isGitWorktreeAddTarget(
        "D:/code/VisionNext",
        "D:/code/wt/VisionNext-flowedit-m12",
        "cd D:/code/VisionNext && git worktree add D:/code/wt/VisionNext-flowedit-m12 -b task/flowedit-dag-m12-typed-edge-roundtrip HEAD",
        (cwd, args) => {
          if (cwd !== "D:/code/VisionNext") return "";
          return args.join(" ") === "rev-parse --show-toplevel"
            ? "D:/code/VisionNext\n"
            : "";
        },
      ),
    ).toBe(true);
  });

  it("recognizes a quoted git worktree add target after branch options", () => {
    expect(
      isGitWorktreeAddTarget(
        "D:/code/VisionNext",
        "D:/code/wt/VisionNext flowedit m12",
        "git worktree add -b task/demo 'D:/code/wt/VisionNext flowedit m12' HEAD",
        (_cwd, args) =>
          args.join(" ") === "rev-parse --show-toplevel"
            ? "D:/code/VisionNext\n"
            : "",
      ),
    ).toBe(true);
  });

  it("does not recognize worktree add targets outside a git repository", () => {
    expect(
      isGitWorktreeAddTarget(
        "D:/code/not-a-repo",
        "D:/code/wt/VisionNext-flowedit-m12",
        "git worktree add D:/code/wt/VisionNext-flowedit-m12 HEAD",
        () => "",
      ),
    ).toBe(false);
  });

  it("does not treat unrelated repositories as same-repo worktrees", () => {
    expect(
      isSameRepositoryWorktreePath(
        "D:/code/VisionNext",
        "D:/code/OtherRepo",
        (cwd) =>
          cwd.includes("OtherRepo")
            ? "D:/code/OtherRepo/.git\n"
            : "D:/code/VisionNext/.git\n",
      ),
    ).toBe(false);
  });
});
