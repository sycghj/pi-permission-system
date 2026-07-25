import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  DEFAULT_EXTENSION_CONFIG,
  type PermissionSystemExtensionConfig,
} from "#src/extension-config";
import { createPermissionSystemLogger } from "#src/logging";

describe("createPermissionSystemLogger", () => {
  let baseDir: string;
  let logsDir: string;
  let debugLogPath: string;
  let reviewLogPath: string;
  let config: PermissionSystemExtensionConfig;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-logs-"));
    logsDir = join(baseDir, "logs");
    debugLogPath = join(logsDir, "debug.jsonl");
    reviewLogPath = join(logsDir, "review.jsonl");
    config = { ...DEFAULT_EXTENSION_CONFIG };
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  function makeLogger() {
    return createPermissionSystemLogger({
      getConfig: () => config,
      debugLogPath,
      reviewLogPath,
      ensureLogsDirectory: () => {
        mkdirSync(logsDir, { recursive: true });
        return undefined;
      },
    });
  }

  test("respects debug toggle and keeps review log enabled by default", () => {
    const logger = makeLogger();

    const initialDebugWarning = logger.debug("debug.disabled", {
      sample: true,
    });
    const reviewWarning = logger.review("permission_request.waiting", {
      toolName: "write",
    });

    expect(initialDebugWarning).toBe(undefined);
    expect(reviewWarning).toBe(undefined);
    expect(existsSync(debugLogPath)).toBe(false);
    expect(existsSync(reviewLogPath)).toBe(true);

    config.debugLog = true;
    const enabledDebugWarning = logger.debug("debug.enabled", { sample: true });
    expect(enabledDebugWarning).toBe(undefined);
    expect(existsSync(debugLogPath)).toBe(true);
    expect(readFileSync(debugLogPath, "utf8")).toMatch(/debug\.enabled/);
  });
});
