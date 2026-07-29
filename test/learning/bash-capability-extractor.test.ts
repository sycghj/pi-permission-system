import { describe, expect, it } from "vitest";

import { BashProgram } from "#src/access-intent/bash/program";
import { extractBashCapability } from "#src/learning/bash-capability-extractor";
import { posixPathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path-normalizer";

const cwd = "/repo/app";
const normalizer = new PathNormalizer(posixPathFlavor, cwd);

async function extract(command: string) {
  return extractBashCapability({
    program: await BashProgram.parse(command, normalizer),
    cwd,
    source: "tool_call",
    agentName: "agent-1",
    projectIdentity: { kind: "git-common-dir", id: "git:/repo/app/.git" },
  });
}

describe("extractBashCapability", () => {
  it("classifies exact pwd as active R0", async () => {
    await expect(extract("pwd")).resolves.toMatchObject({
      family: "pwd",
      baseRisk: "R0",
      effectiveRisk: "R0",
      eligible: { active: true },
      operation: { kind: "pwd" },
    });
  });

  it("classifies safe git diff as active R1", async () => {
    await expect(extract("git diff -- src/main.ts")).resolves.toMatchObject({
      family: "git-diff",
      baseRisk: "R1",
      effectiveRisk: "R1",
      eligible: { active: true },
      operation: {
        kind: "git-diff",
        mode: "working-tree",
        paths: ["src/main.ts"],
      },
    });
  });

  it("rejects unsafe git diff options", async () => {
    await expect(
      extract("git -c diff.external=meld diff"),
    ).resolves.toMatchObject({
      eligible: { active: false, reason: "unsafe-option" },
    });
    await expect(extract("git diff --no-index a b")).resolves.toMatchObject({
      eligible: { active: false, reason: "unsafe-option" },
    });
  });

  it("classifies safe rg as active R1", async () => {
    await expect(extract("rg TODO src test")).resolves.toMatchObject({
      family: "ripgrep-search",
      baseRisk: "R1",
      eligible: { active: true },
      operation: {
        kind: "ripgrep-search",
        roots: ["src", "test"],
      },
    });
  });

  it("rejects rg preprocessor and symlink-follow options", async () => {
    await expect(extract("rg --pre cat TODO src")).resolves.toMatchObject({
      eligible: { active: false, reason: "unsafe-option" },
    });
    await expect(extract("rg --follow TODO src")).resolves.toMatchObject({
      eligible: { active: false, reason: "unsafe-option" },
    });
  });

  it("keeps stdout-only sed in shadow", async () => {
    await expect(extract("sed -n '1,10p' src/main.ts")).resolves.toMatchObject({
      family: "sed-stdout",
      baseRisk: "R1",
      eligible: { active: false, reason: "shadow-only" },
    });
  });

  it("rejects sed writes and command execution", async () => {
    await expect(extract("sed -i 's/a/b/' src/main.ts")).resolves.toMatchObject(
      {
        eligible: { active: false, reason: "unsafe-option" },
      },
    );
    await expect(extract("sed '1e date' src/main.ts")).resolves.toMatchObject({
      eligible: { active: false, reason: "unsafe-option" },
    });
  });

  it("classifies explicit dotnet build/test as bounded R2", async () => {
    await expect(
      extract("dotnet test src/App.Tests/App.Tests.csproj --no-restore"),
    ).resolves.toMatchObject({
      family: "dotnet-build-test",
      baseRisk: "R2",
      eligible: { active: false, reason: "shadow-only" },
      operation: {
        kind: "dotnet-build-test",
        subcommand: "test",
        projectPath: "src/App.Tests/App.Tests.csproj",
      },
    });
  });

  it("rejects broad dotnet forms", async () => {
    await expect(extract("dotnet test")).resolves.toMatchObject({
      eligible: { active: false, reason: "unsafe-option" },
    });
    await expect(
      extract("dotnet publish src/App/App.csproj"),
    ).resolves.toMatchObject({
      eligible: { active: false, reason: "unsafe-option" },
    });
  });

  it("rejects wrappers, composition, redirection, and env prefixes", async () => {
    await expect(extract("bash -c 'pwd'")).resolves.toMatchObject({
      eligible: { active: false, reason: "wrapper" },
    });
    await expect(extract("pwd && git diff")).resolves.toMatchObject({
      eligible: { active: false, reason: "shell-composition" },
    });
    await expect(extract("git diff > out.txt")).resolves.toMatchObject({
      eligible: { active: false, reason: "shell-composition" },
    });
    await expect(
      extract("GIT_EXTERNAL_DIFF=meld git diff"),
    ).resolves.toMatchObject({
      eligible: { active: false, reason: "unsafe-option" },
    });
  });
});
