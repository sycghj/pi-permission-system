import { describe, expect, it } from "vitest";
import { evaluateAutoModeCases } from "#src/auto-mode-eval";
import type { GoldenAutoModeCase } from "./auto-mode-golden-cases";

const cases: readonly GoldenAutoModeCase[] = [
  caseOf("safe-read", "safe read-only", false),
  caseOf("blocked-secret", "secret exfiltration", true),
  caseOf("missed-danger", "dangerous bash", true),
  caseOf("overblocked-build", "safe local build", false),
];

function caseOf(
  id: string,
  category: string,
  expectBlock: boolean,
): GoldenAutoModeCase {
  return {
    id,
    category,
    toolName: "bash",
    input: { command: id },
    userIntent: `evaluate ${id}`,
    expectBlock,
    expectPromptIncludes: id,
  };
}

describe("autoMode offline eval harness", () => {
  it("summarizes pass, fail, false allow, and false block counts", async () => {
    const report = await evaluateAutoModeCases(cases, {
      classify: async (testCase) => ({
        block:
          testCase.id !== "missed-danger" &&
          testCase.id !== "overblocked-build",
      }),
    });

    expect(report.summary).toEqual({
      total: 4,
      passed: 2,
      failed: 2,
      falseAllow: 1,
      falseBlock: 1,
    });
  });

  it("returns stable per-case rows with expected and actual decisions", async () => {
    const report = await evaluateAutoModeCases(cases, {
      classify: async (testCase) => ({
        block: testCase.id === "blocked-secret",
      }),
    });

    expect(report.rows).toEqual([
      {
        id: "safe-read",
        category: "safe read-only",
        expected: "allow",
        actual: "allow",
        passed: true,
      },
      {
        id: "blocked-secret",
        category: "secret exfiltration",
        expected: "block",
        actual: "block",
        passed: true,
      },
      {
        id: "missed-danger",
        category: "dangerous bash",
        expected: "block",
        actual: "allow",
        passed: false,
      },
      {
        id: "overblocked-build",
        category: "safe local build",
        expected: "allow",
        actual: "allow",
        passed: true,
      },
    ]);
  });

  it("renders a readable deterministic report", async () => {
    const report = await evaluateAutoModeCases(cases, {
      classify: async (testCase) => ({ block: testCase.expectBlock }),
    });

    expect(report.text).toContain(
      "total=4 passed=4 failed=0 falseAllow=0 falseBlock=0",
    );
    expect(report.text).toContain(
      "safe-read safe read-only expected=allow actual=allow pass",
    );
    expect(report.text).toContain(
      "blocked-secret secret exfiltration expected=block actual=block pass",
    );
  });
});
