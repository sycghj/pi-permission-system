import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGlobalConfigPath } from "#src/config-paths";
import { DEFAULT_EXTENSION_CONFIG } from "#src/extension-config";
import piPermissionSystemExtension from "#src/index";
import { makeFakePi } from "#test/helpers/make-fake-pi";

const storeConstructed = vi.hoisted(() => vi.fn());
const evaluatorConstructed = vi.hoisted(() => vi.fn());

vi.mock("#src/learning/session-learning-store", () => ({
  SessionLearningStore: function SessionLearningStore(options: unknown) {
    storeConstructed(options);
  },
}));

vi.mock("#src/learning/learned-grant-evaluator", () => ({
  LearnedGrantEvaluator: function LearnedGrantEvaluator(store: unknown) {
    evaluatorConstructed(store);
  },
}));

let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-perm-learning-comp-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  storeConstructed.mockClear();
  evaluatorConstructed.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

describe("learning runtime composition", () => {
  it("constructs session learning dependencies only when learning is enabled", () => {
    writeGlobalConfig({ learning: { enabled: true, mode: "shadow" } });

    piPermissionSystemExtension(makeFakePi() as unknown as ExtensionAPI);

    expect(storeConstructed).toHaveBeenCalledOnce();
    expect(evaluatorConstructed).toHaveBeenCalledOnce();
  });

  it("leaves learning dependencies disabled by default", () => {
    writeGlobalConfig({});

    piPermissionSystemExtension(makeFakePi() as unknown as ExtensionAPI);

    expect(storeConstructed).not.toHaveBeenCalled();
    expect(evaluatorConstructed).not.toHaveBeenCalled();
  });
});

function writeGlobalConfig(config: Record<string, unknown>): void {
  const globalConfigPath = getGlobalConfigPath(agentDir);
  mkdirSync(dirname(globalConfigPath), { recursive: true });
  writeFileSync(
    globalConfigPath,
    `${JSON.stringify({ ...DEFAULT_EXTENSION_CONFIG, ...config }, null, 2)}\n`,
    "utf8",
  );
}
