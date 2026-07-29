import { describe, expect, it } from "vitest";
import {
  classifierRequestInit,
  parseClassifierResult,
} from "#src/auto-mode-request";
import type { AutoAskDecisionRequest } from "#src/handlers/gates/auto-ask-decider";
import { makeCheckResult } from "#test/helpers/handler-fixtures";

const request: AutoAskDecisionRequest = {
  agentName: null,
  check: makeCheckResult({ state: "ask" }),
  input: { command: "cat C:/Users/tzcbz/.pi/agent/vision-tool.json" },
  prompt: {
    source: "tool_call",
    agentName: null,
    message: "Allow tool 'bash'?",
    toolCallId: "tc-ctx",
    toolName: "bash",
  },
  toolCallId: "tc-ctx",
};

const config = {
  enabled: true,
  provider: "new-provider",
  modelId: "deepseek-v4-flash",
  maxTokens: 256,
  maxRetries: 2,
  fallback: "ask" as const,
  twoStage: {
    enabled: false,
    thinkingBudgetTokens: 1024,
  },
};

describe("auto mode classifier request", () => {
  it("includes cwd and recent user intent from runtime context", () => {
    const init = classifierRequestInit(
      {
        model: "deepseek-v4-flash",
        config,
        request,
        attempt: 0,
        runtime: {
          cwd: "F:/code/pi",
          entries: [
            { type: "assistant", content: "old output" },
            { type: "user", content: "我显式授权写入 vision 配置" },
          ],
        },
      },
      {},
    );

    const body = JSON.parse(init.body as string) as {
      messages: Array<{ content: string }>;
    };
    const content = body.messages[0].content;
    expect(content).toContain("CWD: F:/code/pi");
    expect(content).toContain("我显式授权写入 vision 配置");
  });

  it("includes managed worktree path aliases in runtime context", () => {
    const init = classifierRequestInit(
      {
        model: "deepseek-v4-flash",
        config,
        request: {
          ...request,
          agentName: "trellis-implement",
          input: { path: "src/App.ts" },
        },
        attempt: 0,
        runtime: {
          cwd: "C:/Temp/pi-wt/VisionNext-abc123",
          workspace: {
            kind: "git-worktree",
            agentName: "trellis-implement",
            worktreeCwd: "C:/Temp/pi-wt/VisionNext-abc123",
            parentCwd: "D:/code/VisionNext",
          },
          pathAliases: [
            {
              lexical: "src/App.ts",
              projectRelative: "src/App.ts",
              worktreeAbsolute: "C:/Temp/pi-wt/VisionNext-abc123/src/App.ts",
              parentEquivalent: "D:/code/VisionNext/src/App.ts",
            },
          ],
        },
      },
      {},
    );

    const body = JSON.parse(init.body as string) as {
      messages: Array<{ content: string }>;
    };
    const content = body.messages[0].content;
    expect(content).toContain("Workspace: git-worktree");
    expect(content).toContain("Agent: trellis-implement");
    expect(content).toContain("Parent project root: D:/code/VisionNext");
    expect(content).toContain("Worktree root: C:/Temp/pi-wt/VisionNext-abc123");
    expect(content).toContain("Project-relative path: src/App.ts");
    expect(content).toContain(
      "Worktree absolute path: C:/Temp/pi-wt/VisionNext-abc123/src/App.ts",
    );
    expect(content).toContain(
      "Parent-equivalent path: D:/code/VisionNext/src/App.ts",
    );
  });

  it("includes structured capability projection for classifier context", () => {
    const init = classifierRequestInit(
      {
        model: "deepseek-v4-flash",
        config,
        request: {
          ...request,
          check: makeCheckResult({
            state: "ask",
            toolName: "bash",
            source: "bash",
            matchedPattern: "*",
            command: "git status --short",
          }),
          input: { command: "git status --short" },
        },
        attempt: 0,
        runtime: { cwd: "D:/code/VisionNext" },
      },
      {},
    );

    const body = JSON.parse(init.body as string) as {
      messages: Array<{ content: string }>;
    };
    const content = body.messages[0].content;
    expect(content).toContain("Capability projection:");
    expect(content).toContain("Surface: bash");
    expect(content).toContain("Operation: shell-command");
    expect(content).toContain("Command: git status --short");
    expect(content).toContain("Effects: read-only, local");
    expect(content).toContain("Workdir: D:/code/VisionNext");
  });

  it("does not stop before classifier reasons", () => {
    const init = classifierRequestInit(
      {
        model: "deepseek-v4-flash",
        config,
        request,
        attempt: 0,
      },
      {},
    );

    const body = JSON.parse(init.body as string) as {
      stop_sequences?: string[];
    };
    expect(body.stop_sequences).toBeUndefined();
  });

  it("adds Anthropic-compatible thinking for second-stage review", () => {
    const init = classifierRequestInit(
      {
        model: "deepseek-v4-flash",
        config: {
          ...config,
          maxTokens: 256,
          twoStage: { enabled: true, thinkingBudgetTokens: 512 },
        },
        request,
        attempt: 0,
        stage: "review",
      },
      {},
    );

    const body = JSON.parse(init.body as string) as {
      max_tokens: number;
      thinking: { type: string; budget_tokens: number };
      messages: Array<{ content: string }>;
    };
    expect(body.max_tokens).toBe(640);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 512 });
    expect(body.messages[0].content).toContain("Review mode:");
  });

  it("treats explicit ask/abstain output as malformed classifier output", () => {
    expect(
      parseClassifierResult(
        "<ask>yes</ask><reason>need user confirmation</reason>",
      ),
    ).toEqual({ kind: "invalid" });
  });
});
