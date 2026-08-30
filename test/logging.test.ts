import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
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

  describe("file permissions", () => {
    test("creates the review log owner-only", () => {
      makeLogger().review("permission_request.waiting", { toolName: "write" });

      expect(statSync(reviewLogPath).mode & 0o777).toBe(0o600);
    });

    test("creates the debug log owner-only", () => {
      config.debugLog = true;
      makeLogger().debug("permission.decision", { toolName: "write" });

      expect(statSync(debugLogPath).mode & 0o777).toBe(0o600);
    });

    test("tightens a log inherited from an earlier version on next write", () => {
      mkdirSync(logsDir, { recursive: true });
      writeFileSync(reviewLogPath, "{}\n", "utf-8");
      chmodSync(reviewLogPath, 0o644);

      makeLogger().review("permission_request.waiting", { toolName: "write" });

      expect(statSync(reviewLogPath).mode & 0o777).toBe(0o600);
    });
  });

  describe("redaction", () => {
    test("masks sensitive-keyed values before they reach the review log", () => {
      const logger = makeLogger();

      logger.review("permission_request.waiting", {
        toolName: "http",
        headers: { authorization: "Bearer TEST_VALUE" },
      });

      const written = readFileSync(reviewLogPath, "utf8");
      expect(written).not.toContain("TEST_VALUE");
      expect(JSON.parse(written.trim())).toMatchObject({
        toolName: "http",
        headers: { authorization: "[redacted]" },
      });
    });

    test("masks sensitive-keyed values in the debug log too", () => {
      config.debugLog = true;
      const logger = makeLogger();

      logger.debug("permission.decision", {
        toolName: "http",
        apiKey: "sk-real-value",
      });

      const written = readFileSync(debugLogPath, "utf8");
      expect(written).not.toContain("sk-real-value");
      expect(JSON.parse(written.trim())).toMatchObject({
        toolName: "http",
        apiKey: "[redacted]",
      });
    });

    test("leaves a bash command string unredacted, as documented", () => {
      const logger = makeLogger();

      logger.review("permission_request.waiting", {
        toolName: "bash",
        command: "deploy --token abc123",
      });

      expect(readFileSync(reviewLogPath, "utf8")).toContain(
        "deploy --token abc123",
      );
    });
  });

  test("identifies the process and extension runtime on every log entry", () => {
    const logger = makeLogger();

    logger.review("permission_request.waiting", { toolName: "write" });
    logger.review("permission_request.approved", { toolName: "write" });

    const entries = readFileSync(reviewLogPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ processId: process.pid });
    expect(entries[0]?.runtimeId).toEqual(expect.any(String));
    expect(entries[1]?.runtimeId).toBe(entries[0]?.runtimeId);
  });

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
